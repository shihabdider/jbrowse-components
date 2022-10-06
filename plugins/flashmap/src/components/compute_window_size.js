/* Computes an estiamte of the required window size for the reference sketch 
 * (to run with MashMap directly) for a given query length and error rate
 */

const quantile = require( '@stdlib/stats-base-dists-binomial-quantile' );
const cdf = require('binomial-cdf');
const fs = require('fs');

const FIXED_CONFIDENCE_INTERVAL = 0.75

/**
* @brief         jaccard estimate to mash distance
* @param { Number } j   jaccard estimate
* @param { Number } k   kmer size 
*
* @return        mash distance [0.0 - 1.0]
*/
function j2md(j, k) {
    if(j == 0) { return 1.0; } //jaccard estimate 0 -> 1.0 mash distance
        
    if(j == 1) { return 0.0; } //jaccard estimate 1 -> 0.0 mash distance

    const mashDist = (-1.0 / k) * Math.log(2.0 * j/(1+j) );
    return mashDist;
}

/**
* @brief         mash distance to jaccard estimate
* @param { Number } d   mash distance [0.0 - 1.0]
* @param { Number } k   kmer size 
*
* @return        jaccard estimate 
*/
function md2j(d, k) {
    const jaccard = 1.0 / (2.0 * Math.exp( k*d ) - 1.0);
    return jaccard;
}

/**
* @brief               Given a distance d, compute the lower bound on d within required confidence interval 
* @details             If a given match has distance d in the L2 stage, we compare its lower distance bound 
*                      against the assumed cutoff to decide its significance. This makes the mapping algorithm
*                      more sensitive to true alignments
* @param[in]   d       calculated mash distance
* @param[in]   s       sketch size
* @param[in]   k       kmer size
* @param[in]   ci      confidence interval [0-1], example 0.9 implies 90% confidence interval
* @return              computed lower bound on d within 'ci' confidence interval
*/
function mdLowerBound(d, s, k, ci) {
    //One side interval probability
    const q2 = (1.0 - ci)/2;

    let x = Math.max( Math.ceil(s * md2j(d,k)), 1 ); //Begin search from jaccard * s
    while(x <= s) {
        //probability of having x or more shared sketches
        const cdfComplement = 1 - cdf(x-1, s, md2j(d,k));

        if (cdfComplement < q2)
        {
            x--;  //Last guess was right
            break;
        }

        x++;
    }

    const jaccard = x / s;
    const lowD = j2md(jaccard, k);
    return lowD; 
}

/**
* @brief                 Estimate minimum number of shared sketches to achieve the desired identity
* @param { Number } s           sketch size
* @param { Number } k           kmer size
* @param { Number } identity    percentage identity [0-100]
*
* @return                minimum count of hits
*/
function estimateMinimumHits(s, k, percIdentity) {
    //Compute the estimate
    const mashDist = 1.0 - percIdentity/100.0;
    const jaccard = md2j(mashDist, k);

    //function to convert jaccard to min hits
    //Atleast these many minimizers should match for achieving the required 
    //jaccard identity
    const minimumSharedMinimizers = Math.ceil(1.0 * s * jaccard); 

    return minimumSharedMinimizers;
}

/**
* @brief                 Estimate minimum number of shared sketches 
*                        s.t. upper bound identity is >= desired identity
*                        Upper bound is computed using the 90% confidence interval
* @param { Number } s           sketch size
* @param { Number } k           kmer size
* @param { Number } identity    percentage identity [0-100]
*
* @return                       count of min. shared minimizers
*/
function  estimateMinimumHitsRelaxed(s, k, percIdentity) {
    // The desired value has be between [0, min  s.t. identity >= percIdentity]
    const searchRange = [estimateMinimumHits(s, k, percIdentity), 0];

    let minimumSharedMinimizersRelaxed = searchRange[0]

    for(let i = searchRange[0]; i >= searchRange[1]; i--) {
        const jaccard = 1.0 * i/s;
        const d = j2md(jaccard, k);

        const dLower = mdLowerBound(d, s, k, FIXED_CONFIDENCE_INTERVAL);

        //Upper bound identity
        const idUpper = 100.0 * (1.0 - dLower);

        //Check if it satisfies the criteria
        if(idUpper >= percIdentity) {
            minimumSharedMinimizersRelaxed = i;
        } else {
            break;    //Stop the search
        }
    }

    return minimumSharedMinimizersRelaxed;
}

/**
* @param { Number } s               sketch size
* @param { Number } k               kmer size
* @param { Number } alphabetSize    alphabet size
* @param { Number } identity        mapping identity cut-off
* @param { Number } lengthQuery     query length
* @param { Number } lengthReference reference length
*
* @return                    p-value
*/
function estimatePValue(
    s,
    k,
    alphabetSize,
    identity,
    lengthQuery,
    lengthReference
) {
    //total space size of k-mers
    const kmerSpace = alphabetSize**k

    //probability of a kmer match by random in |query| sized sequence 
    let pX, pY; 
    pX = pY = 1. / (1. + kmerSpace / lengthQuery);

    //Jaccard similarity of two random given sequences
    const r = pX * pY / (pX + pY - pX * pY);

    const x = estimateMinimumHitsRelaxed(s, k, identity);

    //P (x or more minimizers match)
    let cdfComplement;
    if(x == 0) {
        cdfComplement = 1.0;
    } else {
        cdfComplement = 1 - cdf(x-1, s, r);
    }

    const pVal = lengthReference * cdfComplement;

    return pVal;
}

/**
* @param { Number } pValueCutoff     cut off p-value threshold
* @param { Number } k                 kmer size
* @param { Number } alphabetSize      alphabet size
* @param { Number } identity          mapping identity cut-off
* @param { Number } segmentLength     mashmap's internal minimum query sequence length
* @param { Number } lengthReference   reference length
*
* @returns { Number } windowSizeEstimate 
*/
function main(
    pValueCutoff,
    k,
    alphabetSize,
    identity,
    segmentLength,
    lengthReference
) {
    const lengthQuery = segmentLength;

      //Push all the sketch values that we should try out in a vector
      //{1, 2, 5, 10, 20, 30...}
    const potentialSketchValues = [1, 2, 5]
    for(let i = 10; i < lengthQuery; i += 10) {
        potentialSketchValues.push(i);
    }

    let optimalSketchSize;

    for(const e of potentialSketchValues) {
        //Compute pvalue
        const pVal = estimatePValue(
            e,
            k,
            alphabetSize,
            identity,
            lengthQuery,
            lengthReference
        );

        //Check if pvalue is <= cutoff
        if(pVal <= pValueCutoff)
        {
            optimalSketchSize = e;
            break;
        }
    }
      
    const windowSizeEstimate =  2.0 * lengthQuery/optimalSketchSize;

      // 1 <= w <= lengthQuery
    return Math.min(Math.max(windowSizeEstimate, 1), lengthQuery)
}

function generateWindowData(refLength) {
    const pValueCutoff = 1e-3
    const kmerLength = 16
    const alphaSize = 4

    const queryLengths = []
    const maxQueryLength = 400_000
    for (let i=1000; i <= maxQueryLength; i+=1000) {
        queryLengths.push(i)
    }

    const data = []
    for (const queryLength of queryLengths) {
        for (let percIdentity=80; percIdentity <= 100; percIdentity+=0.5) {
            const windowSize = main(pValueCutoff, kmerLength, alphaSize, percIdentity, queryLength, refLength)
            data.push([queryLength, percIdentity, windowSize])
        }
    }

    return data
}

function writeData(data, outputFile) {
    const file = fs.createWriteStream(outputFile);
    file.on('error', function(err) { console.error('Could not write', err) });
    data.forEach(function(v) { file.write(v.join(', ') + '\n'); });
    file.end();
}

function tests() {
    // pValueCutoff, k, alphabetSize, identity, segmentLength, lengthReference
    const pValueCutoff = 1e-3
    console.log(main(pValueCutoff, 16, 4, 95, 5000, 3e9))
    console.log(main(pValueCutoff, 16, 4, 0, 5000, 3e9))
    console.log(main(pValueCutoff, 16, 4, 100, 5000, 3e9))
    console.log(main(pValueCutoff, 16, 4, 95, 20000, 3e9))
    console.log(main(pValueCutoff, 16, 4, 95, 20000, 1e6))
    console.log(main(pValueCutoff, 16, 4, 95, 20000, 1e7))
}

module.exports = { main: main }
