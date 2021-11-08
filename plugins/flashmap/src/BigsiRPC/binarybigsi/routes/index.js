var express = require('express');
var router = express.Router();
var fs = require('fs')
const BitSet = require('bitset')

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

/* GET bigsi dump file*/
router.get('/public/:filename', function(req, res){
    const path = 
        '/Users/shihabdider/Research/Flashmap/jbrowse_demo/jbrowse-components/plugins/flashmap/src/BigsiRPC/binarybigsi/public/' 
        + req.params.filename
    const bigsiRowBuf = fs.readFileSync(path)
    res.send(bigsiRowBuf)
})

module.exports = router;
