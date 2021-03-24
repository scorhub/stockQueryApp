var express = require('express');
var router = express.Router();
var config = require('../utils/config');
var options = config.DATABASE_OPTIONS;
var knex = require('knex')(options);
var fs = require('fs');
var multer = require('multer');
var parse = require('csv-parse');

var storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'public/uploads') },
  filename: function (req, file, cb) { cb(null, file.fieldname) }
});
var upload = multer({ storage: storage })


router.get('/', function(req, res, next) {
  res.render('index', { title: 'Stock Query App - MVP' });
});

router.post('/api/file', upload.single('csvfile'), function(req, res, next) {
    // Create parser to parse CSV-data
  var parser = parse({columns: true}, function (err, records) {
      // Check if table aready exists.
    knex.schema.hasTable(req.body.symbol).then(function(exists) {
      if (!exists) {
        knex.schema.createTable(req.body.symbol, t => {
          t.increments("id").primary();
          t.date("date").unique();
          t.decimal("close", 10,4);
          t.integer("volume", 20);
          t.decimal("open", 10,4);
          t.decimal("high", 10,4);
          t.decimal("low", 10,4);
        }).then(created => next() );
      };
        // Convert data to a format that is accepted by MySQL
      let formattedData = [];
      records.map(row => {
        data = row;
        data.Date = new Date(Date.parse(row.Date)).toLocaleString();
          // Assing new keys to objects and delete old ones
          // And check if data has extra spaces (from tested datasets first key 'Date' did not had extra spaces)
        if(row[' Volume']){
          row['date'] = row['Date'];
          row['close'] = row[' Close/Last'];
          row['volume'] = row[' Volume'];
          row['open'] = row[' Open'];
          row['high'] = row[' High'];
          row['low'] = row[' Low'];
          ['Date', ' Close/Last', ' Volume', ' Open',' High', ' Low'].forEach(e => delete row[e]);
        } else {
          row['date'] = row['Date'];
          row['close'] = row['Close/Last'];
          row['volume'] = row['Volume'];
          row['open'] = row['Open'];
          row['high'] = row['High'];
          row['low'] = row['Low'];
          ['Date', 'Close/Last','Volume','Open','High','Low'].forEach(e => delete row[e]);
        };
          // Remove dollar signs and spaces from prices
        data.close = row.close.replace(/\$| /g, '');
        data.open = row.open.replace(/\$| /g, '');
        data.high = row.high.replace(/\$| /g, '');
        data.low = row.low.replace(/\$| /g, '');
          // Push to array
        formattedData.push(row);
      });
        // Update to database for later use, ignore rows with same date as already in database
      knex(req.body.symbol).insert(formattedData).onConflict('date').ignore()
      .then(status => { })
      .catch(err => { console.log(err); res.status(500).json({error:'Database error.' + err}) });
    });
  });
    // Upload file to be parsed
  fs.createReadStream(req.file.path).pipe(parser);
    // Remove uploaded file
  fs.unlinkSync(req.file.path);

  res.send('ok')
});

module.exports = router;