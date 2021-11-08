/* Queries a bigsi matrix of buckets from a reference sequence
 *
 * Input: A query sequence as a string
 * Output: An object containing hits per bucket where hits are either
 *  a) number of query fragments found in bucket
 *  b) number of minimizers found in bucket
 *
 *  A query fragment represents an exact match of length equal to the fragment 
 *  (e.g 2.5Kbp). 
 *
 *  A minimizer represents an exact match of (w + k - 1) bp, i.e 
 *  an exact match of (w + k - 1) bps guarantees a shared minimizer with a 
 *  false positive rate equal to that of the Bloom Filter (generally too small 
 *  to be of concern). w, indicates the window size used to construct the 
 *  minimizer and is set 100, meaning each minimizer "represents" 50 k-mers.
 *  
 */

const cdf = require('binomial-cdf')
const matrix = require('matrix-js')
const BitSet = require('bitset')
const fs = require('fs')
const helper = require('./helper.js')

// One function is used for fragmenting and winnowing to prevent double 
// iteration
async function winnowQueryFragments(querySeq, fragmentSize=0){

    const querySize = querySeq.length

    const queryFragmentsMinimizers = []

    if (fragmentSize == 0){ //for non-frag queries
        const queryMinimizers = helper.extractMinimizers(querySeq)
        queryFragmentsMinimizers.push(queryMinimizers)
    } else {

        if (querySize <= 300_000 && querySize >= fragmentSize){

            for (let n=0; n < Math.floor(querySize/fragmentSize); n++){
                const start = n*fragmentSize
                const end = Math.min(start + fragmentSize, querySize)
                const queryFragmentSeq = querySeq.slice(start, end)
                const queryFragmentMinimizers = helper.extractMinimizers(queryFragmentSeq)
                queryFragmentsMinimizers.push(queryFragmentMinimizers)
            }
        } else { console.error("Inappropriate query size") }
    }

    return queryFragmentsMinimizers
}

function makeFragmentsBloomFilters(queryFragmentsMinimizers, bloomFilterSize){

    const fragmentsBloomFilters = []
    for (let fragmentMinimizerSet of queryFragmentsMinimizers){
        const bf = helper.makeMinimizersBloomFilter(fragmentMinimizerSet, bloomFilterSize)
        fragmentsBloomFilters.push(bf)
    }

    return fragmentsBloomFilters
}

function getBloomFilterSetBitsIndices(queryBF){
    return queryBF.reduce((indices, number, index) => {
        if (number != 0) indices.push(index)
        return indices
    }, [])
}

/**
 * @param { Uint16Array } bigsi - flattened bigsi 
 * @param { array of numbers } rowFilter - array of row numbers for query rows
 * @param { number } numCols - number of columns in bigsi
 *
 * @returns { matrix } submatrix - query rows submatrix
 */
function getBinaryBigsiSubmatrix(bigsi, rowFilter, numCols){
    const submatrixRows = []

    const numSeqs = numCols/16

    for (const rowNum of rowFilter){

        const offsetStart = rowNum*numSeqs
        const offsetEnd = offsetStart + numSeqs

        const rowInts = Array.from(bigsi.subarray(offsetStart, offsetEnd))
        const rowBitStrings = rowInts.map((num) => helper.zeroPadBitstring(num.toString(2), 16))
        const rowBitString = rowBitStrings.join('')

        // Front padding ensures all columns are accounted for
        const row = rowBitString.split('').map(Number)
        submatrixRows.push(row)
    }

    const submatrix = matrix(submatrixRows)

    return submatrix
}

// hexBigsi is an array of hexstrings
function getHexBigsiSubmatrix(hexBigsi, rowFilter){
    const submatrixRows = []

    for (const rowNum of rowFilter){

        const rowHex = hexBigsi[rowNum]
        const rowBitString = parseInt(rowHex, 16).toString(2).padStart(16, '0')
        // Front padding ensures all columns are accounted for
        const row = rowBitString.split('').map(Number)
        submatrixRows.push(row)
    }

    const submatrix = matrix(submatrixRows)

    return submatrix
}

/**
 * @param { matrix } submatrix - array of submatrix for query rows 
 * of bigsi
 * @param { bigsiHits } bigsiHits - empty object for storing returned hits 
 *
 * @returns - bigsiHits with updated hits attributes 
 */
function computeSubmatrixHits(submatrix, bigsiHits, numBuckets){
    let bucketHits = (new BitSet).flip() // init bitset to all 1s for bitwise AND
    const numRows = submatrix.size()[0]
    for (let row = 0; row < numRows; row++) {
        const rowBitString = submatrix(row).join('')
        const rowBS = new BitSet(rowBitString)
        bucketHits = bucketHits.and(rowBS)
    }

    // Use bigsiHits to compute the total number of buckets instead of bitset 
    // length because the latter truncates leading zeros when converted to 
    // a string
    //const numBuckets = Object.keys(bigsiHits).length
    
    // bitset.toArray returns an array of indices (i) corresponding to the set bits
    // to convert this to bucket numbers (B - 1) - i, where B is 
    // the total number of buckets
    const hitsBucketNums = bucketHits.toArray().map( value => (numBuckets - 1) - value )

    for (let i = 0; i < hitsBucketNums.length; i++){
        const bucketNum = hitsBucketNums[i]
        if (bucketNum in bigsiHits){
            bigsiHits[bucketNum]['hits'] += 1
        } else {
            bigsiHits[bucketNum] = {'hits': 1}
        }

    }
}

//column sum
const sum = (r, a) => r.map((b, i) => a[i] + b);

// Containment score is the Jaccard containment identity:
// Hamming weight of submatrix columns divided by
// number of minimizers inserted into query Bloom Filter
function computeQueryContainmentScores(submatrix, bigsiHits) {
    const queryMinimizerCount = submatrix.size()[0]
    const hammingWeights = submatrix().reduce(sum)
    //const submatrix_T = submatrix.trans()
    //const hammingWeights = []
    //for (const row of submatrix_T){
    //    const bs = new BitSet(row.join(''))
    //    const weight = bs.cardinality()
    //    hammingWeights.push(weight)
    //}

    for (let bucketNum = 0; bucketNum < hammingWeights.length; bucketNum++){
        const containmentScore = hammingWeights[bucketNum]/queryMinimizerCount
        if (containmentScore >= 0.8) {
            bigsiHits[bucketNum] = {'containment': containmentScore}
        }
    }

}

function queryHexBigsi(hexBigsi, queryFragmentsBloomFilters){
    const bigsiHits = {}

    const numFragments = queryFragmentsBloomFilters.length
    console.log('number of query fragments: ', numFragments)

    for (const bloomFilter of queryFragmentsBloomFilters){
        const queryBFSetBitsIndices = getBloomFilterSetBitsIndices(bloomFilter._filter)
        
        const querySubmatrix = getHexBigsiSubmatrix(hexBigsi, queryBFSetBitsIndices)

        if (numFragments == 1){
            computeQueryContainmentScores(querySubmatrix, bigsiHits)
        } else {
            computeSubmatrixHits(querySubmatrix, bigsiHits, numCols)
        }
    }

    if (numFragments !== 1){
        for (const bucketId in bigsiHits) {
            bigsiHits[bucketId]['score'] = `${bigsiHits[bucketId]['hits']}/${numFragments}`;
        }
    }

    return bigsiHits
}

/** 
 * @param { array of bloom filters } queryFragmentsBloomFilters - an array of Bloom filters with fragment 
 * minimizers inserted
 * @param { string } numCols - number of columns in bigsi
 *
 * @return { object } filteredBigsiHits - object containing fragment hits in the bigsi buckets
 */
async function queryBinaryBigsi(bigsiArray, queryFragmentsBloomFilters, numCols){

    const bigsiHits = {}

    const numFragments = queryFragmentsBloomFilters.length
    console.log('number of query fragments: ', numFragments)

    for (const bloomFilter of queryFragmentsBloomFilters){
        const queryBFSetBitsIndices = getBloomFilterSetBitsIndices(bloomFilter._filter)
        
        const querySubmatrix = await getBinaryBigsiSubmatrix(bigsiArray, queryBFSetBitsIndices, numCols)

        if (numFragments == 1){
            computeQueryContainmentScores(querySubmatrix, bigsiHits)
        } else {
            computeSubmatrixHits(querySubmatrix, bigsiHits, numCols)
        }
    }

    if (numFragments !== 1){
        for (const bucketId in bigsiHits) {
            bigsiHits[bucketId]['score'] = `${bigsiHits[bucketId]['hits']}/${numFragments}`;
        }
    } else {
        for (const bucketId in bigsiHits) {
            bigsiHits[bucketId]['score'] = `${bigsiHits[bucketId]['containment']}`;
        }
    }

    return bigsiHits
}

async function main(querySeq) {
    const bigsiPath = 'http://localhost:3001/public/hg38_whole_genome.bin'
    const response = await fetch(bigsiPath)
    const bigsiBuffer = await response.arrayBuffer()
    console.log('num bytes in the bigsi buffer:', bigsiBuffer.byteLength)

    let bigsiArray = new Uint16Array(bigsiBuffer);
    console.log('bigsiArray size: ', bigsiArray.length)
    
    const numCols = 16*24
    const bloomFilterSize = bigsiArray.length*16/numCols
    //const queryFragmentsMinimizers = await winnowQueryFragments(querySeq)
    // Test: non-frag query
    const queryFragmentsMinimizers = await winnowQueryFragments(querySeq)
    const queryMask = await makeFragmentsBloomFilters(queryFragmentsMinimizers, bloomFilterSize)

    const filteredBigsiHits = await queryBinaryBigsi(bigsiArray, queryMask, numCols)

    return filteredBigsiHits
}

module.exports = {
    winnowQueryFragments: winnowQueryFragments,
    makeFragmentsBloomFilters: makeFragmentsBloomFilters,
    getBloomFilterSetBitsIndices: getBloomFilterSetBitsIndices,
    getBinaryBigsiSubmatrix: getBinaryBigsiSubmatrix,
    getHexBigsiSubmatrix: getHexBigsiSubmatrix,
    computeSubmatrixHits: computeSubmatrixHits,
    computeQueryContainmentScores: computeQueryContainmentScores, 
    queryBinaryBigsi: queryBinaryBigsi,
    queryHexBigsi: queryHexBigsi,
    main: main
}
