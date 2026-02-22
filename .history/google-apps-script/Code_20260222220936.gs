var SHEET_READINGS = 'meter_readings';
var SHEET_LOGS = 'logs';

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    Logger.log('doGet params: %s', JSON.stringify(params));

    if (params.action === 'health') {
      return jsonResponse({
        ok: true,
        message: 'Apps Script is running',
        hasReadingsSheet: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_READINGS),
        hasLogsSheet: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOGS),
      });
    }

    return jsonResponse({ ok: true, message: 'Use POST with action=listReadings|saveReading' });
  } catch (err) {
    Logger.log('doGet error: %s', err && err.stack ? err.stack : String(err));
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    var action = body.action;
    Logger.log('doPost action=%s body=%s', action, JSON.stringify(body));

    if (action === 'saveReading') {
      return jsonResponse(saveReading_(body.record, body.actor || 'owner'));
    }

    if (action === 'listReadings') {
      return jsonResponse(listReadings_(body.roomNo || 'ROOM-1'));
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    Logger.log('doPost error: %s', err && err.stack ? err.stack : String(err));
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name);
  }
  return sheet;
}

function getHeaderMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[String(headers[i]).trim()] = i;
  }
  return map;
}

function rowToObject_(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}

function listReadings_(roomNo) {
  Logger.log('listReadings_ roomNo=%s', roomNo);
  var readingsSheet = getSheet_(SHEET_READINGS);
  var logsSheet = getSheet_(SHEET_LOGS);

  var readingsValues = readingsSheet.getDataRange().getValues();
  var logsValues = logsSheet.getDataRange().getValues();

  var readings = [];
  if (readingsValues.length > 1) {
    var readingHeaders = readingsValues[0];
    for (var i = 1; i < readingsValues.length; i++) {
      var readingObj = rowToObject_(readingHeaders, readingsValues[i]);
      if (!roomNo || readingObj.roomNo === roomNo) {
        readings.push(readingObj);
      }
    }
  }

  var logs = [];
  if (logsValues.length > 1) {
    var logHeaders = logsValues[0];
    for (var j = 1; j < logsValues.length; j++) {
      var logObj = rowToObject_(logHeaders, logsValues[j]);
      if (!roomNo || logObj.roomNo === roomNo) {
        try {
          logObj.detail = JSON.parse(logObj.detail || '{}');
        } catch (err) {
          logObj.detail = { raw: logObj.detail };
        }
        logs.push(logObj);
      }
    }
  }

  Logger.log('listReadings_ result readings=%s logs=%s', readings.length, logs.length);
  return { ok: true, readings: readings, logs: logs };
}

function saveReading_(record, actor) {
  if (!record || !record.id) {
    throw new Error('Invalid record');
  }
  Logger.log('saveReading_ roomNo=%s billingMonth=%s actor=%s', record.roomNo, record.billingMonth, actor);

  var readingsSheet = getSheet_(SHEET_READINGS);
  var logsSheet = getSheet_(SHEET_LOGS);
  var readingHeaders = readingsSheet.getRange(1, 1, 1, readingsSheet.getLastColumn()).getValues()[0];
  var readingMap = getHeaderMap_(readingsSheet);
  var data = readingsSheet.getDataRange().getValues();

  var rowIndexToUpdate = -1;
  var previousData = null;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowRoomNo = row[readingMap.roomNo];
    var rowBillingMonth = row[readingMap.billingMonth];
    if (rowRoomNo === record.roomNo && rowBillingMonth === record.billingMonth) {
      rowIndexToUpdate = i + 1; // sheet rows are 1-based
      previousData = rowToObject_(readingHeaders, row);
      break;
    }
  }

  var values = readingHeaders.map(function (header) {
    var value = record[header];
    return value === undefined || value === null ? '' : value;
  });

  if (rowIndexToUpdate > 0) {
    readingsSheet.getRange(rowIndexToUpdate, 1, 1, values.length).setValues([values]);
    Logger.log('saveReading_ updated row=%s', rowIndexToUpdate);
  } else {
    readingsSheet.appendRow(values);
    Logger.log('saveReading_ appended new row');
  }

  var logHeaders = logsSheet.getRange(1, 1, 1, logsSheet.getLastColumn()).getValues()[0];
  var logPayload = {
    id: Utilities.getUuid(),
    timestamp: new Date().toISOString(),
    action: 'SAVE_READING',
    actor: actor || 'owner',
    roomNo: record.roomNo || '',
    billingMonth: record.billingMonth || '',
    detail: JSON.stringify({ before: previousData, after: record }),
  };

  var logValues = logHeaders.map(function (header) {
    var value = logPayload[header];
    return value === undefined || value === null ? '' : value;
  });
  logsSheet.appendRow(logValues);
  Logger.log('saveReading_ appended log row for billingMonth=%s', record.billingMonth);

  return { ok: true };
}
