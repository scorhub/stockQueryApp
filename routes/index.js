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
      // Check validity of the data => if insufficient or invalid, send error to user
    if(records.length < 5){
      res.send('ERROR! Needs data at least from 5 days.');
    } else if(req.body.symbol === null || req.body.symbol === null || req.body.symbol.length < 1){
      res.send('ERROR! Stock symbol missing.');
    } else if(req.body.startdate.length !== 10 || !(new Date(req.body.startdate) instanceof Date) || Date.parse(new Date(req.body.startdate)) >=  Date.parse(new Date(req.body.enddate))){
      res.send('ERROR! Starting date invalid (or later than ending date).');
    } else if(req.body.enddate.length !== 10 || !(new Date(req.body.enddate) instanceof Date)){
      res.send('ERROR! Ending date invalid.');
    } else {
        // Convert stock symbol to lowercase
      req.body.symbol = req.body.symbol.toLowerCase();
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
          // Get basic data with requested (date) parameters from database
        knex.select('date', 'open', 'close').from(req.body.symbol).whereBetween('date', [req.body.startdate, req.body.enddate]).orderBy('date', 'ASC')
        .then(requestedData => {
            // Get data for volume and price query
          knex.select('date', 'volume', 'high', knex.raw("(high - low) AS priceChange FROM :symbol: WHERE volume = (SELECT MAX(volume) FROM :symbol: WHERE date BETWEEN :startdate AND :enddate) UNION ALL SELECT date, volume, high, (high - low) AS priceChange FROM :symbol: WHERE (high - low) = (SELECT MAX(high - low) FROM :symbol: WHERE date BETWEEN :startdate AND :enddate) ORDER BY volume DESC, priceChange DESC", { symbol: req.body.symbol, startdate: req.body.startdate, enddate: req.body.enddate }))
          .then(knexRawQuery => {
            let returnedArray = [];
              // Remove time from date
            requestedData.map(row => {
              row.date = new Date(Date.parse(row.date)).toLocaleString().split(' ')[0];
              returnedArray.push(row);
            });
              // Remove uploaded file temporary file
            fs.unlinkSync(req.file.path);

            // Create functions to calculate required results from data; longest bullish trend, highest trading volume & price change and opening price compared to SMA 5

            function calcBullish(array) {
                // Create empty array, from which longest bullish can be calculated
              let bullishList = [];
                // Check longest bullish trend from given date range
                // Map bullish trends in own arrays inside array
                array.map(obj => {
                if(bullishList.length === 0) {
                  bullishList.push(new Array(obj));
                } else {
                  if(obj.close > bullishList[bullishList.length-1][Array.length-1].close){
                    bullishList[bullishList.length-1].push(obj);
                  } else  {
                    bullishList.push(new Array(obj));
                  };
                };
              });
                // Check which array is longest, or if multiple arrays are equally longest, which arrays they are
              function longest_arrays(arrayOfArrays) {
                var max = arrayOfArrays[0].length;
                arrayOfArrays.map(arr => max = Math.max(max, arr.length));
                result = arrayOfArrays.filter(arr => arr.length == max);
                return result;
              };
              let longestBullish = [];
              longest_arrays(bullishList).map(arr => {
                longestBullish.push(new Object({length: arr.length, starting: arr[0].date, ending: arr[arr.length-1].date}));
              });
              return longestBullish;
            };

            function getVolumeAndPrice(arr, req){
              let volumeAndPrice = [];
              arr.map(row => {
                row.date = new Date(Date.parse(row.date)).toLocaleString().split(' ')[0];
                row.priceChangePercent = Math.floor(row.priceChange / row.high * 10000) / 100 + "%";
                volumeAndPrice.push(row);
              });
              return volumeAndPrice;
            };

            function calcComparedToSMA(arr, range, res){
              if (!Array.isArray(arr) || typeof arr[0] !== 'object' || arr.length < range){ res.send('ERROR! Needs array with at least ' + range + ' objects'); };
              var array = [];
              var len = arr.length + 1;
              var idx = range - 1;
              while (++idx < len) {
                var round = range;
                var sum = 0;
                while (round--) sum += Number(arr.slice(idx - range, idx)[round].close);
                var obj = arr[idx-1];
                obj.sma = sum / range;
                obj.bestOpening = Math.floor((Number(obj.open) - obj.sma) / ((Number(obj.open) + obj.sma) /2) * 100*100)/100;
                array.push(obj);
              };
              return array.sort((a,b) => (b.bestOpening > a.bestOpening) ? 1 : ((a.bestOpening > b.bestOpening) ? -1 : 0));;
            };
            
              // Range were defined on assignment
            let range = 5;
              // Run calculations and render result page to user
            res.render('results', { longestBullish: calcBullish(returnedArray), volumeAndPrice: getVolumeAndPrice(knexRawQuery, req), comparedToSMA: calcComparedToSMA(returnedArray, range, res) });

          }).catch(err => { res.status(500).json({error:'Database error.' + err}) });
        }).catch(err => { res.status(500).json({error:'Database error.' + err}) });
      }).catch(err => { res.status(500).json({error:'Database error.' + err}) });
    };
  })();
});

module.exports = router;