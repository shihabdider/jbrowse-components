import createModule from './mashmap_module.js'

function processMashmapResults(results){
    console.log(results.split(' '))
}

async function main(refSketchName, query, percIdentity){
    const Module = await createModule()
    const refSketchPath = `http://localhost:3001/public/sketches/${refSketchName}`
    const response = await fetch(refSketchPath)
    const refBuffer = await response.arrayBuffer()
    const refSketchArray = new Uint8Array(refBuffer);
    const segLength = Math.min(query.length - 500, 19999)
    Module.FS.writeFile('ref.sketch', refSketchArray)
    Module.FS.writeFile('query.fa', query)
    Module.callMain(['--rs', 'ref.sketch', '-q', 'query.fa', '-o', 'test.out', '-t', '1', '--pi', percIdentity, '-s', segLength.toString()])
    const output = Module.FS.readFile('test.out', { encoding: 'utf8' })
    return output
}

export default main
