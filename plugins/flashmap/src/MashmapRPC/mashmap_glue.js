const fs = require('fs');
const Module = require('./mashmap.js')

async function main(ref, query){
    Module.FS.writeFile('ref.fa', ref)
    Module.FS.writeFile('query.fa', query)
    Module.callMain(['-r', 'ref.fa', '-q', 'query.fa', '-o', 'test.out', '-t', '1'])
    const output = Module.FS.readFile('test.out', { encoding: 'utf8' })
    console.log(output)
}

