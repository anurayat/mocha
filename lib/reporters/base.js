'use strict';
/**
 * @module Base
 */
/**
 * Module dependencies.
 */

var tty = require('tty');
var diff = require('diff');
var milliseconds = require('ms');
var utils = require('../utils');
var supportsColor = process.browser ? null : require('supports-color');
var constants = require('../runner').constants;
var EVENT_TEST_PASS = constants.EVENT_TEST_PASS;
var EVENT_TEST_FAIL = constants.EVENT_TEST_FAIL;

/**
 * Expose `Base`.
 */

exports = module.exports = Base;

/**
 * Check if both stdio streams are associated with a tty.
 */

var isatty = tty.isatty(1) && tty.isatty(2);

/**
 * Enable coloring by default, except in the browser interface.
 */

exports.useColors =
  !process.browser &&
  (supportsColor.stdout || process.env.MOCHA_COLORS !== undefined);

/**
 * Inline diffs instead of +/-
 */

exports.inlineDiffs = false;

/**
 * Default color map.
 */

exports.colors = {
  pass: 90,
  fail: 31,
  'bright pass': 92,
  'bright fail': 91,
  'bright yellow': 93,
  pending: 36,
  suite: 0,
  'error title': 0,
  'error message': 31,
  'error stack': 90,
  checkmark: 32,
  fast: 90,
  medium: 33,
  slow: 31,
  green: 32,
  light: 90,
  'diff gutter': 90,
  'diff added': 32,
  'diff removed': 31
};

/**
 * Default symbol map.
 */

exports.symbols = {
  ok: '✓',
  err: '✖',
  dot: '․',
  comma: ',',
  bang: '!'
};

// With node.js on Windows: use symbols available in terminal default fonts
if (process.platform === 'win32') {
  exports.symbols.ok = '\u221A';
  exports.symbols.err = '\u00D7';
  exports.symbols.dot = '.';
}

/**
 * Color `str` with the given `type`,
 * allowing colors to be disabled,
 * as well as user-defined color
 * schemes.
 *
 * @param {string} type
 * @param {string} str
 * @return {string}
 * @private
 */
var color = (exports.color = function(type, str) {
  if (!exports.useColors) {
    return String(str);
  }
  return '\u001b[' + exports.colors[type] + 'm' + str + '\u001b[0m';
});

/**
 * Expose term window size, with some defaults for when stderr is not a tty.
 */

exports.window = {
  width: 75
};

if (isatty) {
  exports.window.width = process.stdout.getWindowSize
    ? process.stdout.getWindowSize(1)[0]
    : tty.getWindowSize()[1];
}

/**
 * Expose some basic cursor interactions that are common among reporters.
 */

exports.cursor = {
  hide: function() {
    isatty && process.stdout.write('\u001b[?25l');
  },

  show: function() {
    isatty && process.stdout.write('\u001b[?25h');
  },

  deleteLine: function() {
    isatty && process.stdout.write('\u001b[2K');
  },

  beginningOfLine: function() {
    isatty && process.stdout.write('\u001b[0G');
  },

  CR: function() {
    if (isatty) {
      exports.cursor.deleteLine();
      exports.cursor.beginningOfLine();
    } else {
      process.stdout.write('\r');
    }
  }
};

function showDiff(err) {
  return (
    err &&
    err.showDiff !== false &&
    sameType(err.actual, err.expected) &&
    err.expected !== undefined
  );
}

function stringifyDiffObjs(err) {
  if (!utils.isString(err.actual) || !utils.isString(err.expected)) {
    err.actual = utils.stringify(err.actual);
    err.expected = utils.stringify(err.expected);
  }
}

/**
 * Returns a diff between 2 strings with coloured ANSI output.
 *
 * The diff will be either inline or unified dependant on the value
 * of `Base.inlineDiff`.
 *
 * @param {string} actual
 * @param {string} expected
 * @return {string} Diff
 */
var generateDiff = (exports.generateDiff = function(actual, expected) {
  return exports.inlineDiffs
    ? inlineDiff(actual, expected)
    : unifiedDiff(actual, expected);
});

/**
 * Output the given `failures` as a list.
 *
 * @public
 * @memberof Mocha.reporters.Base
 * @variation 1
 * @param {Array} failures
 */

exports.list = function(failures) {
  console.log();
  failures.forEach(function(test, i) {
    // format
    var fmt =
      color('error title', '  %s) %s:\n') +
      color('error message', '     %s') +
      color('error stack', '\n%s\n');

    // msg
    var msg;
    var err = test.err;
    var message;
    if (err.message && typeof err.message.toString === 'function') {
      message = err.message + '';
    } else if (typeof err.inspect === 'function') {
      message = err.inspect() + '';
    } else {
      message = '';
    }
    var stack = err.stack || message;
    var index = message ? stack.indexOf(message) : -1;

    if (index === -1) {
      msg = message;
    } else {
      index += message.length;
      msg = stack.slice(0, index);
      // remove msg from stack
      stack = stack.slice(index + 1);
    }

    // uncaught
    if (err.uncaught) {
      msg = 'Uncaught ' + msg;
    }
    // explicitly show diff
    if (!exports.hideDiff && showDiff(err)) {
      stringifyDiffObjs(err);
      fmt =
        color('error title', '  %s) %s:\n%s') + color('error stack', '\n%s\n');
      var match = message.match(/^([^:]+): expected/);
      msg = '\n      ' + color('error message', match ? match[1] : msg);

      msg += generateDiff(err.actual, err.expected);
    }

    // indent stack trace
    stack = stack.replace(/^/gm, '  ');

    // indented test title
    var testTitle = '';
    test.titlePath().forEach(function(str, index) {
      if (index !== 0) {
        testTitle += '\n     ';
      }
      for (var i = 0; i < index; i++) {
        testTitle += '  ';
      }
      testTitle += str;
    });

    console.log(fmt, i + 1, testTitle, msg, stack);
  });
};

/**
 * Initialize a new `Base` reporter.
 *
 * All other reporters generally
 * inherit from this reporter.
 *
 * @memberof Mocha.reporters
 * @public
 * @class
 * @param {Runner} runner
 */

function Base(runner) {
  var failures = (this.failures = []);

  if (!runner) {
    throw new TypeError('Missing runner argument');
  }
  this.stats = runner.stats; // assigned so Reporters keep a closer reference
  this.runner = runner;

  runner.on(EVENT_TEST_PASS, function(test) {
    if (test.duration > test.slow()) {
      test.speed = 'slow';
    } else if (test.duration > test.slow() / 2) {
      test.speed = 'medium';
    } else {
      test.speed = 'fast';
    }
  });

  runner.on(EVENT_TEST_FAIL, function(test, err) {
    if (showDiff(err)) {
      stringifyDiffObjs(err);
    }
    test.err = err;
    failures.push(test);
  });
}

/**
 * Output common epilogue used by many of
 * the bundled reporters.
 *
 * @memberof Mocha.reporters.Base
 * @public
 */
Base.prototype.epilogue = function() {
  var stats = this.stats;
  var fmt;

  console.log();

  // passes
  fmt =
    color('bright pass', ' ') +
    color('green', ' %d passing') +
    color('light', ' (%s)');

  console.log(fmt, stats.passes || 0, milliseconds(stats.duration));

  // pending
  if (stats.pending) {
    fmt = color('pending', ' ') + color('pending', ' %d pending');

    console.log(fmt, stats.pending);
  }

  // failures
  if (stats.failures) {
    fmt = color('fail', '  %d failing');

    console.log(fmt, stats.failures);

    Base.list(this.failures);
    console.log();
  }

  console.log();
};

/**
 * Pad the given `str` to `len`.
 *
 * @private
 * @param {string} str
 * @param {string} len
 * @return {string}
 */
function pad(str, len) {
  str = String(str);
  return Array(len - str.length + 1).join(' ') + str;
}

/**
 * Returns an inline diff between 2 strings with coloured ANSI output.
 *
 * @private
 * @param {String} actual
 * @param {String} expected
 * @return {string} Diff
 */
function inlineDiff(actual, expected) {
  var msg = errorDiff(actual, expected);

  // linenos
  var lines = msg.split('\n');
  if (lines.length > 4) {
    var width = String(lines.length).length;
    msg = lines
      .map(function(str, i) {
        return pad(++i, width) + ' |' + ' ' + str;
      })
      .join('\n');
  }

  // legend
  msg =
    '\n' +
    color('diff removed', 'actual') +
    ' ' +
    color('diff added', 'expected') +
    '\n\n' +
    msg +
    '\n';

  // indent
  msg = msg.replace(/^/gm, '      ');
  return msg;
}

/**
 * Returns a unified diff between two strings with coloured ANSI output.
 *
 * @private
 * @param {String} actual
 * @param {String} expected
 * @return {string} The diff.
 */
function unifiedDiff(actual, expected) {
  var indent = '      ';
  function cleanUp(line) {
    if (line[0] === '+') {
      return indent + colorLines('diff added', line);
    }
    if (line[0] === '-') {
      return indent + colorLines('diff removed', line);
    }
    if (line.match(/@@/)) {
      return '--';
    }
    if (line.match(/\\ No newline/)) {
      return null;
    }
    return indent + line;
  }
  function notBlank(line) {
    return typeof line !== 'undefined' && line !== null;
  }
  var msg = diff.createPatch('string', actual, expected);
  var lines = msg.split('\n').splice(5);
  return (
    '\n      ' +
    colorLines('diff added', '+ expected') +
    ' ' +
    colorLines('diff removed', '- actual') +
    '\n\n' +
    lines
      .map(cleanUp)
      .filter(notBlank)
      .join('\n')
  );
}

/**
 * Return a character diff for `err`.
 *
 * @private
 * @param {String} actual
 * @param {String} expected
 * @return {string} the diff
 */
function errorDiff(actual, expected) {
  return diff
    .diffWordsWithSpace(actual, expected)
    .map(function(str) {
      if (str.added) {
        return colorLines('diff added', str.value);
      }
      if (str.removed) {
        return colorLines('diff removed', str.value);
      }
      return str.value;
    })
    .join('');
}

/**
 * Color lines for `str`, using the color `name`.
 *
 * @private
 * @param {string} name
 * @param {string} str
 * @return {string}
 */
function colorLines(name, str) {
  return str
    .split('\n')
    .map(function(str) {
      return color(name, str);
    })
    .join('\n');
}

/**
 * Object#toString reference.
 */
var objToString = Object.prototype.toString;

/**
 * Check that a / b have the same type.
 *
 * @private
 * @param {Object} a
 * @param {Object} b
 * @return {boolean}
 */
function sameType(a, b) {
  return objToString.call(a) === objToString.call(b);
}

Base.abstract = true;
