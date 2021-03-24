var express = require('express');
var router = express.Router();
var config = require('../utils/config');
var options = config.DATABASE_OPTIONS;
var knex = require('knex')(options);
var fs = require('fs');
var multer = require('multer');
var parseSync = require('csv-parse/lib/sync');

  // Configure multer options
var storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'public/temp') },
  filename: function (req, file, cb) { cb(null, file.fieldname) }
});
var upload = multer({ storage: storage })


router.get('/', function(req, res, next) {
  res.render('index', { title: 'Stock Query App - MVP' });
});

router.post('/api/file', upload.single('csvfile'), function(req, res, next) {
  (async function () {
    const fileContent = await fs.promises.readFile(req.file.path);
    const records = parseSync(fileContent, {columns: true});
      // Check if table already exists in database.
    await knex.schema.hasTable(req.body.symbol).then(function(exists) {
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
    });
      // Convert data to a format that is accepted by MySQL
    let formattedData = [];
    await Promise.all(records.map(async (row) => {
        // Assing new keys to objects and delete old ones
        // And check if data has extra spaces (from tested datasets first key 'Date' didn't had extra spaces, and isn't converted as rest of the keys)
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
        // Parse date to accepted form
      row.date = new Date(Date.parse(row.date)).toLocaleString();
        // Remove dollar signs and spaces from prices
      row.close = row.close.replace(/\$| /g, '');
      row.open = row.open.replace(/\$| /g, '');
      row.high = row.high.replace(/\$| /g, '');
      row.low = row.low.replace(/\$| /g, '');
        // Push to array
      formattedData.push(row);
    }));
      // Update to database, ignore rows with same date as already in database
    knex(req.body.symbol).insert(formattedData).onConflict('date').ignore()
    .then(status => {
        // Get data with requested (date) parameters from database
      knex.select('*').from(req.body.symbol).whereBetween('date', [req.body.startdate, req.body.enddate]).orderBy('date', 'ASC')
      .then(rows => {
        let result = [];
        rows.map(row => {
            // Remove time from date
          row.date = new Date(Date.parse(row.date)).toLocaleString().split(' ')[0];
          result.push(row);
        });
          // Remove uploaded file temporary file
        fs.unlinkSync(req.file.path);
        res.send(result);
      }).catch(err => { res.status(500).json({error:'Database error.' + err}) });
    }).catch(err => { res.status(500).json({error:'Database error.' + err}) });
  })();
});

module.exports = router;