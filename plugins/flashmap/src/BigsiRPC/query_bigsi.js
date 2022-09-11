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

import * as fs from 'fs'
import * as helper from './helper.js'
import bigsiConfig from './bigsis.config.local.json'
import * as BitSet from 'bitset'
import matrix from 'matrix-js'
import * as quantile from '@stdlib/stats-base-dists-binomial-quantile'

// const cdf = require('binomial-cdf')
// const matrix = require('matrix-js')
// const BitSet = require('bitset')
// const fs = require('fs')
// const helper = require('./helper.js')
// const bigsiConfig = require('./bigsis.config.json')

// One function is used for fragmenting and winnowing to prevent double 
// iteration
async function winnowQueryFragments(querySeq, fragmentSize=0){

    const querySize = querySeq.length

    const queryFragmentsMinimizers = []

    if (fragmentSize == 0){ // for non-frag queries
        const queryMinimizers = helper.extractMinimizers(querySeq)
        queryFragmentsMinimizers.push(queryMinimizers)
    } else {
        for (let n=0; n < Math.floor(querySize/fragmentSize); n++){
            const start = n*fragmentSize
            const end = Math.min(start + fragmentSize, querySize)
            const queryFragmentSeq = querySeq.slice(start, end)
            const queryFragmentMinimizers = helper.extractMinimizers(queryFragmentSeq)
            queryFragmentsMinimizers.push(queryFragmentMinimizers)
        }
    }

    return queryFragmentsMinimizers
}

function makeFragmentsBloomFilters(queryFragmentsMinimizers, bloomFilterSize){

    const fragmentsBloomFilters = []
    for (const fragmentMinimizerSet of queryFragmentsMinimizers){
        const bf = helper.makeMinimizersBloomFilter(fragmentMinimizerSet, bloomFilterSize)
        fragmentsBloomFilters.push(bf)
    }

    return fragmentsBloomFilters
}

function getBloomFilterSetBitsIndices(queryBF){
    return queryBF.reduce((indices, number, index) => {
        if (number != 0) {indices.push(index)}
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
    console.log('numRows', bigsi.length/24)
    const submatrixRows = []

    const intSize = 16
    const numSeqs = numCols/intSize

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
    const and = (r, a) => r.map((b, i) => a[i] && b);
    const bucketHits = submatrix().reduce(and)

    const hitsBucketNums = []
    bucketHits.forEach((hit, bucketNum) => hit === 1 ? hitsBucketNums.push(bucketNum) : null)

    for (const bucketNum of hitsBucketNums){
        if (bucketNum in bigsiHits){
            bigsiHits[bucketNum]['hits'] += 1
        } else {
            bigsiHits[bucketNum] = {'hits': 1}
        }

    }
}


// column sum
const sum = (r, a) => r.map((b, i) => a[i] + b);

function computeLowerBoundContainmentScore(containmentScore, 
    numMinimizersInQuery, confidenceInterval) {
    let x = quantile(confidenceInterval, numMinimizersInQuery, containmentScore)

    const lowerBoundContainmentScore = Math.min(x / numMinimizersInQuery, 1)
    return lowerBoundContainmentScore
}

// Containment score is the Jaccard containment identity =
// Hamming weight of submatrix columns divided by
// number of minimizers inserted into query Bloom Filter
function computeQueryContainmentScores(submatrix, bigsiHits, subrate) {
    const kmerLength = 16
    const numMinimizersInQuery = submatrix.size()[0]
    const submatrix_T = submatrix.trans()
    const hammingWeights = []
    for (const row of submatrix_T) {
        const bs = new BitSet(row.join(''))
        const weight = bs.cardinality()
        hammingWeights.push(weight)
    }

    for (let bucketNum = 0; bucketNum < hammingWeights.length; bucketNum++){
        let numMatchingMinimizers = hammingWeights[bucketNum]
        if (numMatchingMinimizers > 0) {
            let containmentScore = numMatchingMinimizers/numMinimizersInQuery
            let containmentBias = 0
            if (subrate != 0) {
                containmentScore = Math.max(containmentScore, 0)
                const pValThreshold = 0.99995
                containmentScore = computeLowerBoundContainmentScore(containmentScore, numMinimizersInQuery, pValThreshold)
            }
            const errorRate = Math.max(-1/kmerLength * Math.log(containmentScore), 0)
            if (errorRate <= subrate) {
                const percentMatch = 100*(1 - errorRate)
                bigsiHits[bucketNum] = {'containment': percentMatch}
            }
        }
    }
}


/** 
 * @param { array of bloom filters } queryFragmentsBloomFilters - an array of Bloom filters with fragment 
 * minimizers inserted
 * @param { string } numCols - number of columns in bigsi
 *
 * @return { object } filteredBigsiHits - object containing fragment hits in the bigsi buckets
 */
async function queryBinaryBigsi(bigsiArray, queryFragmentsBloomFilters, numCols, subrate){

    const bigsiHits = {}

    const numFragments = queryFragmentsBloomFilters.length
    console.log('number of query fragments: ', numFragments)

    for (const bloomFilter of queryFragmentsBloomFilters){
        const queryBFSetBitsIndices = getBloomFilterSetBitsIndices(bloomFilter._filter)
        
        const querySubmatrix = await getBinaryBigsiSubmatrix(bigsiArray, queryBFSetBitsIndices, numCols)

        if (numFragments === 1){
            computeQueryContainmentScores(querySubmatrix, bigsiHits, subrate)
        } else {
            computeSubmatrixHits(querySubmatrix, bigsiHits, numCols)
        }
    }

    if (numFragments !== 1){
        for (const bucketId in bigsiHits) {
            bigsiHits[bucketId]['score'] = `${bigsiHits[bucketId]['hits']} out of ${numFragments} fragments`;
        }
    } else {
        for (const bucketId in bigsiHits) {
            bigsiHits[bucketId]['score'] = `${bigsiHits[bucketId]['containment']}`;
        }
    }

    return bigsiHits
}

async function nonFragQuery(querySeq, bigsiName, subrate){
    const bigsiPath = bigsiConfig[bigsiName].path
    const queryFragmentsMinimizers = await winnowQueryFragments(querySeq)
    const numCols = bigsiConfig[bigsiName].numCols
    const bloomFilterSize = bigsiConfig[bigsiName].numRows

    const response = await fetch(bigsiPath)
    const bigsiBuffer = await response.arrayBuffer()
    const bigsiArray = new Uint16Array(bigsiBuffer);
    
    const querySize = querySeq.length
    const queryMask = await makeFragmentsBloomFilters(queryFragmentsMinimizers, bloomFilterSize)
    const filteredBigsiHits = await queryBinaryBigsi(bigsiArray, queryMask, numCols, subrate)


    return filteredBigsiHits
}

async function main(querySeq, bigsiName, subrate) {
    let filteredBigsiHits 
    const querySize = querySeq.length
    if (querySize > 5000 && querySize <= 20_000) {
        filteredBigsiHits = await nonFragQuery(querySeq, bigsiName, subrate)
    } else {
        return console.error('Query must be between 500bp to 300Kbp')
    }

    return filteredBigsiHits
}

export { main }

// module.exports = {
//    winnowQueryFragments: winnowQueryFragments,
//    makeFragmentsBloomFilters: makeFragmentsBloomFilters,
//    getBloomFilterSetBitsIndices: getBloomFilterSetBitsIndices,
//    getBinaryBigsiSubmatrix: getBinaryBigsiSubmatrix,
//    getHexBigsiSubmatrix: getHexBigsiSubmatrix,
//    computeSubmatrixHits: computeSubmatrixHits,
//    computeQueryContainmentScores: computeQueryContainmentScores, 
//    queryBinaryBigsi: queryBinaryBigsi,
//    queryHexBigsi: queryHexBigsi,
//    main: main,
// }
