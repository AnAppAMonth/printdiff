
var util = require('util');
var objectDiff = require('objectdiff');
var charDiff = require('chardiff');

var consoleColumns = process.stdout.columns;

var red = '\x1B[31m',
    green = '\x1B[32m',
    cyan = '\x1B[36m',
    clear = '\x1B[0m';

/**
 * This function takes a string to be printed to the console, and formats
 * it so that when it wraps, 4 spaces are prepended to the next line to
 * make it more readable.
 *
 * The input string can contain color sequences which take spaces in the
 * string, but not in the printed output. So this function must be able
 * to deal with them.
 *
 * @param {string} str - the input string.
 * @returns {string} the output string.
 * @private
 */
function _lineBreak(str, columns) {
    var result = '';

    // As an optimization, if the length of str (including color sequences)
    // doesn't exceed the console's width, this is definitely an one-liner.
    if (str.length <= columns) {
        return str;
    }

    // The start index in `str` of the current line.
    var start = 0;
    // The number of actual characters counted into the current line.
    var ct = 0;
    // Whether we are inside a color sequence.
    var inSeq = false;

    for (var i = 0; i < str.length; i++) {
        if (str[i] === '\x1B') {
            inSeq = true;
        } else if (inSeq) {
            if (str[i] === 'm') {
                inSeq = false;
            }
        } else {
            ct++;
            if (str[i] === '\n' || ct === columns) {
                // We have finished counting a line.
                if (start) {
                    // This isn't the first line, prepend '\n' and 4 spaces.
                    result += '\n    ';
                } else {
                    // This is the first line, all subsequent lines must leave
                    // space for the 4 spaces prepended.
                    columns -= 4;
                }
                // Add the line to the result.
                if (str[i] === '\n') {
                    // The line break is triggered by a '\n', don't include
                    // it into the resulting string.
                    result += str.substring(start, i);
                } else {
                    result += str.substring(start, i + 1);
                }
                start = i + 1;
                ct = 0;
            }
        }
    }

    // Add the last line to the result.
    if (start) {
        // This isn't the first line, prepend '\n' and 4 spaces.
        result += '\n    ';
    }
    result += str.substring(start);

    return result;
}

function _printLine(line, prefix, columns, style) {
    if (prefix.length >= 3) {
        prefix += ' ';
    } else {
        prefix += new Array(5 - prefix.length).join(' ');
    }

    columns -= prefix.length;
    if (line.length > columns) {
        line = line.substring(0, columns - 3) + '...';
    }

    line = prefix + line;

    if (style) {
        line = style + line + clear;
    }

    return line;
}

function _printColumns() {

}

// Returns the new `lastPrintedLine`.
function _printContextLines(result, lines, curLine, lastPrintedLine, postContextLine, contextLines) {
    var startLine, endLine,
        i;

    // Print post-context lines for the previous change if existed.
    if (postContextLine >= 0) {
        // Print context lines `postContextLine` ~ `postContextLine+contextLines-1`
        // in `a` if necessary.
        startLine = Math.max(postContextLine, lastPrintedLine + 1);
        endLine = Math.min(postContextLine + contextLines, curLine);
        for (i = startLine; i < endLine; i++) {
            result.push(_printLine(lines[i], i + 1 + '', columns, null));
        }
    }

    // Print context lines `curLine-contextLines` ~ `curLine-1` in `a`
    // if necessary.
    startLine = Math.max(curLine - contextLines, lastPrintedLine + 1, 0);
    for (i = startLine; i < curLine; i++) {
        result.push(_printLine(lines[i], i + 1 + '', columns, null));
    }

    return lastPrintedLine;
}

/**
 * This function uses the `diff` library to diff two strings and generates a
 * nice-looking diff (inspired by file diffs) from the result.
 *
 * The difference between this function and the file diff algorithm is that
 * this function takes the first operand (`a`) as the base and outputs what
 * changes are to be made to convert `a` to `b`. As a result, we don't care
 * about line and column numbers in `b`: all line and column numbers in the
 * output are those in `a`.
 *
 * @param {string} a - diff operand 1.
 * @param {string} b - diff operand 2.
 * @returns {Array} empty if equal, otherwise a list of changes.
 * @private
 */
function _generateStringDiff(a, b, columns) {
    // A "line" is a line in one of the operands.
    // A "chunk" is a displayed line on the screen, limited by tty's width.
    var maxChunks = 200,
        maxChunksPerLine = 20,
        contextLines = 3,
        contextColumns = 25,
        maxColumns = 50;

    // Context lines are fetched from `lines`.
    var lines = a.split('\n'),
        i, j, k, ln;

    var result = [],
        // The current (upcoming) line number in `a`.
        curLine = 0,
        // Line number of the last printed line in `a`.
        lastPrintedLine = -1,
        // The first post-context line from the last change, we need to record
        // this because we can only print it when we are at the next change.
        postContextLine = -1,
        // The total number of chunks printed so far, used to enforce the
        // `maxChunks` setting.
        totalChunks = 0,
        startLine;

    // Holds char-level result before merging into `result`.
    var colRes,
        // The current (upcoming) column number in the current line in 'a'.
        curColumn,
        // Column number of the last printed column in the current line in `a`.
        lastPrintedColumn,
        // The first post-context column from the last change, we need to record
        // this because we can only print it when we are at the next change.
        postContextColumn,
        // The number of chunks printed so far for the current line, used to
        // enforce the `maxChunksPerLine` setting.
        lineChunks = 0,
        startColumn;

    // Format strings
    var changeStr = [];
    var removeStr = ['-   %s',
                     '\x1B[31m-   %s\x1B[0m'];
    var addStr = ['+   %s',
                  '\x1B[32m+   %s\x1B[0m'];
//    var idx = colors ? 1 : 0;


    var changeset = charDiff(a, b);

    for (i = 0; i < changeset.length; i++) {
        var change = changeset[i];

        if (change.type === '=') {      // Unchanged
            curLine++;
        } else if (change.type === '-') {   // Removed
            // Print context lines `curLine-contextLines` ~ `curLine-1` in `a`
            // if necessary.
            startLine = Math.max(curLine - contextLines, lastPrintedLine + 1, 0);
            for (j = startLine; j < curLine; j++) {
                result.push(_printLine(lines[j], j + 1 + '', columns, null));
            }

            // Print the removed line.
            result.push(_printLine(lines[curLine], curLine + 1 + '', columns, red));

            // Update `lastPrintedLine`.
            lastPrintedLine = curLine;

            curLine++;

        } else if (change.type === '+') {   // Added
            // Print context lines `curLine-contextLines` ~ `curLine-1` in `a`
            // if necessary.
            startLine = Math.max(curLine - contextLines, lastPrintedLine + 1, 0);
            for (j = startLine; j < curLine; j++) {
                result.push(_printLine(lines[j], j + 1 + '', columns, null));
            }

            // Print the added line, strip the trailing line break if existed.
            ln = change.right;
            if (ln[ln.length - 1] === '\n') {
                ln = ln.substring(0, ln.length - 1);
            }
            result.push(_printLine(ln, '', columns, green));

            // Update `lastPrintedLine`.
            lastPrintedLine = curLine - 1;

        } else {    // Changed
            // Print context lines `curLine-contextLines` ~ `curLine-1` in `a`
            // if necessary.
            startLine = Math.max(curLine - contextLines, lastPrintedLine + 1, 0);
            for (j = startLine; j < curLine; j++) {
                result.push(_printLine(lines[j], j + 1 + '', columns, null));
            }

            // Process char-level diffs
            colRes = [];
            curColumn = 0;
            lastPrintedColumn = -1;
            postContextColumn = -1;
            for (j = 0; j < change.diff.length; j++) {
                var chg = change.diff[j];

                if (chg.type === '=') {
                    curColumn++;
                } else if (chg.type === '-') {
                    curColumn++;

                } else if (chg.type === '+') {
                    curColumn++;

                } else {
                    curColumn++;

                }
            }
//            result.push(colRes.join(''));

            // Print the removed line.
            result.push(_printLine(lines[curLine], curLine + 1 + '', columns, red));

            // Print the added line, strip the trailing line break if existed.
            ln = change.right;
            if (ln[ln.length - 1] === '\n') {
                ln = ln.substring(0, ln.length - 1);
            }
            result.push(_printLine(ln, '', columns, green));

            // Update `lastPrintedLine`.
            lastPrintedLine = curLine;

            curLine++;
        }
    }

    return result;
}

/**
 * This function uses the objectdiff library to diff two objects or
 * literals and generates a nice-looking diff (inspired by file diffs)
 * from the result.
 *
 * @param {*} a - diff operand 1, can be object or literal.
 * @param {*} b - diff operand 2, can be object or literal.
 * @param {boolean} colors - whether to colorize the output.
 * @returns {Array} empty if equal, otherwise a list of changes.
 * @private
 */
function _generateObjectDiff(a, b, colors) {
    var result = [];
    var numberPat = /^\d+$/;

    // Format strings
    var changeStr =  ['*   %s = %s -> %s',
                      '\x1B[36m*   %s\x1B[0m = \x1B[31m%s\x1B[0m -> \x1B[32m%s\x1B[0m'];
    var changeStr2 = ['*   %s -> %s',
                      '\x1B[36m*\x1B[0m   \x1B[31m%s\x1B[0m -> \x1B[32m%s\x1B[0m'];
    var removeStr =  ['-   %s = %s',
                      '\x1B[31m-   %s\x1B[0m = \x1B[31m%s\x1B[0m'];
    var addStr =     ['+   %s = %s',
                      '\x1B[32m+   %s\x1B[0m = \x1B[32m%s\x1B[0m'];
    var idx = colors ? 1 : 0;

    // Traverse the diff object to find all changes.
    function traverse(node, path) {
        var keys, i;
        if (node.changed === 'object change') {
            keys = Object.keys(node.value);
            for (i = 0; i < keys.length; i++) {
                var newPath;
                // If the key is a number, it's probably an array index
                if (numberPat.test(keys[i])) {
                    newPath = '[' + keys[i] + ']';
                    if (path) {
                        newPath = path + newPath;
                    }
                } else {
                    newPath = path ? path + '.' + keys[i] : keys[i];
                }
                traverse(node.value[keys[i]], newPath);
            }

        } else if (node.changed === 'primitive change') {
            result.push(_lineBreak(util.format(changeStr[idx]
                                             , path
                                             , util.inspect(node.removed)
                                             , util.inspect(node.added)), consoleColumns));

        } else if (node.changed === 'removed') {
            result.push(_lineBreak(util.format(removeStr[idx]
                                             , path
                                             , util.inspect(node.value)), consoleColumns));

        } else if (node.changed === 'added') {
            result.push(_lineBreak(util.format(addStr[idx]
                                             , path
                                             , util.inspect(node.value)), consoleColumns));
        }
    }

    // objectdiff only supports comparing two objects.
    if (a instanceof Object && b instanceof Object) {
        var diff = objectDiff.diff(a, b);

        traverse(diff, '');

    } else if (typeof a === 'string' && typeof b === 'string') {
        result = result.concat(_generateStringDiff(a, b, consoleColumns));

    } else {
        if (a !== b) {
            result.push(_lineBreak(util.format(changeStr2[idx]
                                             , util.inspect(a)
                                             , util.inspect(b)), consoleColumns));
        }
    }

    return result;
}

module.exports = function(a, b) {
    console.log(_generateObjectDiff(a, b, true).join('\n'));
};
