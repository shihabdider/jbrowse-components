const murmur = require('murmurhash-js')
const { BloomFilter } = require('bloom-filters')
const { IndexedFasta } = require('@gmod/indexedfasta')
const cdf = require('binomial-cdf');

function zeroPadBitstring(bitstring, places){
    const paddedString = bitstring.padStart(places, '0')
    return paddedString
}

function reverseComplement(sequence){
    var reverseSeq=sequence.split('').reverse().join('')

    let COMPLEMENT_BASES = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'},
        re = /[ATCG]/g;

    var revComplementSeq = reverseSeq.replace(re, function (sequence) {
        return COMPLEMENT_BASES[sequence]
    });

    return revComplementSeq
}

async function loadFasta(fastaPath, faiPath){
    const seq = new IndexedFasta({
        path: fastaPath,
        faiPath: faiPath,
        chunkSizeLimit: 5e7
    });

    return seq
}

/**
 * @param { IndexedFasta } genome -  sequence object for the genome
 * @param { number } seqSizeThreshold - minimum size of sequence to filter
 *
 * @returns { array of strings } seqNames - filtered seq names
 */
async function getFilteredGenomeSeqs(genome, seqSizeThreshold=10**7){
    const seqNames = await genome.getSequenceList()

    const filteredSeqNames = []
    for (let i=0; i < seqNames.length; i++){
        const seqSize = await genome.getSequenceSize(seqNames[i])
        if (seqSize >= seqSizeThreshold){
            filteredSeqNames.push(seqNames[i])
        }
    }

    return filteredSeqNames
    
}

// Based on MashMap's winnowing algorithm
function extractMinimizers(seq){
    seq = seq.toUpperCase()

    const kmerSize = 16
    const windowSize = 100
    const seed = 42

    let minimizers = []
    let deque = [] // array of {hash, offset}
    let revSequence = reverseComplement(seq)
    for (let i = 0; i < (seq.length - kmerSize + 1); i++){
        let currentWindowIndex = i - windowSize + 1
        let kmerHashFwd = murmur.murmur3(seq.slice(i,i+kmerSize), seed)
        let kmerHashBwd = murmur.murmur3(revSequence.slice(-(i+kmerSize), -i), seed)
        let kmerHash = Math.min(kmerHashFwd, kmerHashBwd)

        while (deque.length != 0 && deque[0].offset <= i - windowSize){
            deque.shift()
        }

        while (deque.length != 0 && deque.slice(-1)[0].hash >= kmerHash)
        {
            deque.pop()
        }

        deque.push({'hash':kmerHash, 'offset':i})

        if (currentWindowIndex >= 0){
            if ( minimizers.length == 0 || minimizers.slice(-1)[0] != deque[0].hash )
            {
                minimizers.push(deque[0].hash)
            }
        }
    }

    return minimizers
}

function computeBloomFilterFalsePosRate(numElementsInserted, bloomFilterSize){
    const numHashes = 1

    const falsePos = (1 - Math.exp(
        -1*numHashes*numElementsInserted/bloomFilterSize
    ))**numHashes
    return falsePos
}

function computeFalseHitProb(falsePosRate, minQueryMinimizers, containmentScoreThresh){
    const numMatching = minQueryMinimizers*containmentScoreThresh
    const falseHitProb = 1 - cdf(numMatching, minQueryMinimizers, falsePosRate)
    return falseHitProb
}

function computeBloomFilterSize(maxNumElementsInserted, containmentScoreThresh, totalNumBuckets){
    // initialize set parameters
    const minQueryMinimizers = 100  // 5Kbp min query = 100 minimizers
    const falseHitThresh = 1e-2
    // iterate over a array size range...
    for ( let bloomFilterSize = 0; bloomFilterSize <= 1e6; bloomFilterSize += 1e3 ){
        const falsePosRate = computeBloomFilterFalsePosRate(maxNumElementsInserted, bloomFilterSize)
        const falseHitProb = computeFalseHitProb(
            falsePosRate, 
            minQueryMinimizers, 
            containmentScoreThresh
        )

        // accounting for all buckets in bigsi
        const falseHitProbUpper = falseHitProb*totalNumBuckets
        // break if false hit rate less than threshold and return
        if ( falseHitProbUpper <= falseHitThresh ) {
            console.log(`optimal bloom filter size: ${bloomFilterSize}`)
            return bloomFilterSize
        }
    }
}

function makeMinimizersBloomFilter(minimizers, bloomFilterSize) {
    // adjust filter size based on number of inserted elements and desired false pos 
    // rate
    const numHashes = 1
    const minimizersBloomFilter = new BloomFilter(bloomFilterSize, numHashes)
    for (const minimizer of minimizers){
        minimizersBloomFilter.add(minimizer.toString())
    }
    return minimizersBloomFilter
}

module.exports = {
    zeroPadBitstring: zeroPadBitstring,
    reverseComplement: reverseComplement,
    loadFasta: loadFasta,
    getFilteredGenomeSeqs: getFilteredGenomeSeqs,
    extractMinimizers: extractMinimizers,
    computeBloomFilterFalsePosRate: computeBloomFilterFalsePosRate,
    computeFalseHitProb: computeFalseHitProb,
    computeBloomFilterSize: computeBloomFilterSize,
    makeMinimizersBloomFilter: makeMinimizersBloomFilter,
}

