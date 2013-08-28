
var util = require('util');
var objectDiff = require('objectdiff');
var charDiff = require('chardiff');

var consoleColumns = process.stdout.columns;

// Variables used when printing a string diff.
// A "line" is a line in one of the operands.
// A "chunk" is a displayed line on the screen, limited by tty's width.
var maxChunks = 200,
    maxChunksPerLine = 20,
    contextLines = 3,
    contextColumns = 25,
    maxColumns = 50;

// ANSI color codes for styling.
var red = '\x1B[31m',
    green = '\x1B[32m',
    cyan = '\x1B[36m',
    clear = '\x1B[0m';

/**
 * This function takes a string to be printed to the console, wraps it,
 * and formats it so that each wrapped line is indented by `indent` to
 * make it more readable.
 *
 * The input string can contain color sequences which take space in the
 * string, but not in the printed output. So this function must be able
 * to deal with them.
 *
 * @param {string} str - The input string.
 * @param {number} indent - Indent amount of wrapped lines.
 * @param {number} wrapWidth - The wrapping width.
 * @returns {string} the output string.
 * @private
 */
function _lineBreak(str, indent, wrapWidth) {
    var result = '',
        prefix = new Array(indent + 1).join(' ');

    // As an optimization, if the length of str (including color sequences)
    // doesn't exceed the console's width, this is definitely an one-liner.
    if (str.length <= wrapWidth) {
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
            if (str[i] === '\n' || ct === wrapWidth) {
                // We have finished counting a line.
                if (start) {
                    // This isn't the first line, prepend '\n' and `indent` spaces.
                    result += '\n' + prefix;
                } else {
                    // This is the first line, all subsequent lines must leave
                    // space for the indentation.
                    wrapWidth -= indent;
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

    // Add the last line to the result if it's not empty.
    if (start !== str.length) {
        if (start) {
            // This isn't the first line, prepend '\n' and `indent` spaces.
            result += '\n' + prefix;
        }
        result += str.substring(start);
    }

    return result;
}

function _printLine(line, prefix, wrapWidth, style) {
    if (prefix.length >= 3) {
        prefix += ' ';
    } else {
        prefix += new Array(5 - prefix.length).join(' ');
    }

    wrapWidth -= prefix.length;
    if (line.length > wrapWidth) {
        line = line.substring(0, wrapWidth - 3) + '...';
    }

    line = prefix + line;

    if (style) {
        line = style + line + clear;
    }

    return line;
}

// NOTE that it's the responsibility of the caller to guarantee that `curLine`
// doesn't surpass `lines.length`.
function _printContextLines(result, lines, curLine, postContextLine, wrapWidth) {
    var startLine, endLine = 0,
        i;

    // Print post-context lines for the previous change if existed.
    if (postContextLine >= 0) {
        // Print context lines `postContextLine` ~ `postContextLine+contextLines-1`
        // in `a` if necessary.
        startLine = postContextLine;
        endLine = Math.min(postContextLine + contextLines, curLine);
        for (i = startLine; i < endLine; i++) {
            result.push(_printLine(lines[i], i + 1 + '', wrapWidth, null));
        }
    }

    // Print context lines `curLine-contextLines` ~ `curLine-1` in `a`
    // if necessary.
    startLine = Math.max(curLine - contextLines, endLine, 0);
    if (postContextLine < 0 && startLine > 0) {
        // This is the first change, and `startLine` isn't the first line.
        result.push('...');
    } else if (startLine > endLine) {
        // There is a break between the last change and this one.
        result.push('...');
    }
    endLine = curLine;
    for (i = startLine; i < endLine; i++) {
        result.push(_printLine(lines[i], i + 1 + '', wrapWidth, null));
    }
}

// NOTE that it's the responsibility of the caller to guarantee that `curColumn`
// doesn't surpass `line.length`.
function _printContextColumns(colRes, line, curColumn) {
    if (colRes.length > 0) {
        var lastEntry = colRes[colRes.length - 1];

        // See if the new change should be printed in the same entry as the last
        // change or in a new entry.
        if (curColumn - lastEntry.endColumn > contextColumns * 2) {     // New entry
            // Print post-context columns for the last change in the old entry.
            lastEntry.value += line.substring(lastEntry.endColumn, lastEntry.endColumn + contextColumns);
            lastEntry.value += '...';
            lastEntry.endColumn += contextColumns;

            // Print pre-context columns for the current change in the new entry.
            colRes.push({
                value: '...' + line.substring(curColumn - contextColumns, curColumn),
                startColumn: curColumn - contextColumns,
                endColumn: curColumn
            });
        } else {    // Old entry
            // Print context columns `lastEntry.endColumn` ~ `curColumn-1` in
            // `line` in the old entry.
            lastEntry.value += line.substring(lastEntry.endColumn, curColumn);
            lastEntry.endColumn = curColumn;
        }
    } else {
        // This is the first change, just print pre-context columns for it in a
        // new entry.
        var start = Math.max(curColumn - contextColumns, 0);
        colRes.push({
            value: line.substring(start, curColumn),
            startColumn: start,
            endColumn: curColumn
        });
        if (start > 0) {
            colRes[0].value = '...' + colRes[0].value;
        }
    }
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
function _generateStringDiff(a, b, wrapWidth) {
    // Context lines are fetched from `lines`.
    var lines = a.split('\n'),
        i, j, ln;

    if (lines[lines.length-1] === '') {
        lines.pop();
    }

    // Each entry in `result` is a chunk.
    var result = [],
        // The current (upcoming) line number in `a`.
        curLine = 0,
        // The first post-context line from the last change, we need to record
        // this because we can only print it when we are at the next change.
        postContextLine = -1;

    // Holds char-level result before merging into `result`.
    var colRes,
        // The current (upcoming) column number in the current line in 'a'.
        curColumn,
        // The number of chunks printed so far for the current line, used to
        // enforce the `maxChunksPerLine` setting.
        lineChunks;


    var changeset = charDiff(a, b);

    for (i = 0; i < changeset.length; i++) {
        var change = changeset[i];

        if (change.type === '=') {      // Unchanged
            curLine++;

        } else if (change.type === '-') {   // Removed
            // Print post-context lines for the previous change and pre-context lines
            // for this change.
            _printContextLines(result, lines, curLine, postContextLine, wrapWidth);

            // Print the removed line, if `maxChunks` is not exceeded.
            if (result.length >= maxChunks) {
                result.push(_printLine('...', curLine + 1 + '', wrapWidth, red));
                break;
            }
            result.push(_printLine(lines[curLine], curLine + 1 + '', wrapWidth, red));

            // Update `postContextLine`.
            postContextLine = curLine + 1;

            curLine++;

        } else if (change.type === '+') {   // Added
            // Print post-context lines for the previous change and pre-context lines
            // for this change.
            _printContextLines(result, lines, curLine, postContextLine, wrapWidth);

            // Print the added line, stripping the trailing line break if existed,
            // if `maxChunks` is not exceeded.
            if (result.length >= maxChunks) {
                result.push(_printLine('...', '', wrapWidth, green));
                break;
            }
            ln = change.right;
            if (ln[ln.length - 1] === '\n') {
                ln = ln.substring(0, ln.length - 1);
            }
            result.push(_printLine(ln, '', wrapWidth, green));

            // Update `postContextLine`.
            postContextLine = curLine;

        } else {    // Changed
            // Print post-context lines for the previous change and pre-context lines
            // for this change.
            _printContextLines(result, lines, curLine, postContextLine, wrapWidth);

            if (result.length >= maxChunks) {
                result.push(_printLine('...', curLine + 1 + '', wrapWidth, cyan));
                break;
            }

            // Process char-level diffs
            ln = lines[curLine];
            // Each entry of `colRes` is an object with the following members:
            // - value: text value (incl. styling) of this entry, can span multiple chunks.
            // - startColumn: start column of the value in the line.
            // - endColumn: end column of the value in the line.
            colRes = [];
            curColumn = 0;

            var lastEntry;
            for (j = 0; j < change.diff.length; j++) {
                var chg = change.diff[j];

                if (chg.type === '=') {      // Unchanged
                    curColumn += chg.value.length;

                } else if (chg.type === '-') {   // Removed
                    // Print post-context columns for the previous change and pre-context columns
                    // for this change.
                    _printContextColumns(colRes, ln, curColumn);

                    // Print the removed columns.
                    lastEntry = colRes[colRes.length-1];
                    if (chg.left.length <= maxColumns) {
                        lastEntry.value += red + chg.left + clear;
                    } else {
                        lastEntry.value += red + chg.left.substring(0, maxColumns) + '...' + clear;
                    }
                    lastEntry.endColumn += chg.left.length;

                    curColumn += chg.left.length;

                } else if (chg.type === '+') {   // Added
                    // Print post-context columns for the previous change and pre-context columns
                    // for this change.
                    _printContextColumns(colRes, ln, curColumn);

                    // Print the added columns.
                    lastEntry = colRes[colRes.length-1];
                    if (chg.right.length <= maxColumns) {
                        lastEntry.value += green + chg.right + clear;
                    } else {
                        lastEntry.value += green + chg.right.substring(0, maxColumns) + '...' + clear;
                    }

                } else {    // Changed
                    // Print post-context columns for the previous change and pre-context columns
                    // for this change.
                    _printContextColumns(colRes, ln, curColumn);

                    // Print the removed columns.
                    lastEntry = colRes[colRes.length-1];
                    if (chg.left.length <= maxColumns) {
                        lastEntry.value += red + chg.left + clear;
                    } else {
                        lastEntry.value += red + chg.left.substring(0, maxColumns) + '...' + clear;
                    }
                    lastEntry.endColumn += chg.left.length;

                    // Print the added columns.
                    if (chg.right.length <= maxColumns) {
                        lastEntry.value += green + chg.right + clear;
                    } else {
                        lastEntry.value += green + chg.right.substring(0, maxColumns) + '...' + clear;
                    }

                    curColumn += chg.left.length;
                }

                // Each entry in `colRes` contains one or more chunks.
                if (colRes.length > maxChunksPerLine) {
                    break;
                }
            }

            lastEntry = colRes[colRes.length-1];

            // Print post-context columns for the last change.
            _printContextColumns(colRes, ln, Math.min(lastEntry.endColumn + contextColumns, ln.length));
            if (lastEntry.endColumn < ln.length) {
                lastEntry.value += '...';
            }

            // Merge results in `colRes` into `result`.
            var maxPrefixLen;

            if (lastEntry.startColumn === 0) {
                maxPrefixLen = (curLine + 1 + '').length + 1;
            } else {
                maxPrefixLen = (curLine + 1 + ',' + (lastEntry.startColumn + 1)).length + 1;
            }
            maxPrefixLen = Math.max(maxPrefixLen, 4);

            lineChunks = 0;
            for (j = 0; j < colRes.length; j++) {
                var entry = colRes[j],
                    prefix;

                // Only print start column number if it's not 1.
                if (entry.startColumn === 0) {
                    prefix = curLine + 1 + '';
                } else {
                    prefix = curLine + 1 + ',' + (entry.startColumn + 1);
                }
                prefix = cyan + prefix + clear + new Array(maxPrefixLen - prefix.length + 1).join(' ');

                var res = _lineBreak(prefix + entry.value, maxPrefixLen, wrapWidth).split('\n');

                lineChunks += res.length;
                // At least print one `colRes` entry, after that, we make sure
                // we don't surpass the maximums in config.
                if (j > 0 && (lineChunks > maxChunksPerLine || result.length + res.length > maxChunks)) {
                    result.push(prefix + '...');
                    break;
                }
                result = result.concat(res);
            }

            // Update `postContextLine`.
            postContextLine = curLine + 1;

            curLine++;
        }
    }

    if (i === changeset.length) {
        // We finished the loop normally, now print post-context lines for the
        // last change, and finally an ellipsis if needed.
        _printContextLines(result, lines, Math.min(postContextLine + contextLines, lines.length),
                           postContextLine, wrapWidth);
        if (postContextLine + contextLines < lines.length) {
            // We haven't reached the end of the input.
            result.push('...');
        }
    } else {
        // We broke out of the loop because `maxChunks` is reached.
        // Since we didn't print the current change, we don't need to print
        // post-context lines for it. Just print an ellipsis if needed to
        // indicate that there are still content after this point.
        if (i < changeset.length - 1) {
            // We haven't reached the end of the input.
            result.push('...');
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
function _generateObjectDiff(a, b, options) {
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
    var idx = options.colors ? 1 : 0;

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
                                             , util.inspect(node.added)), 4, options.wrapWidth));

        } else if (node.changed === 'removed') {
            result.push(_lineBreak(util.format(removeStr[idx]
                                             , path
                                             , util.inspect(node.value)), 4, options.wrapWidth));

        } else if (node.changed === 'added') {
            result.push(_lineBreak(util.format(addStr[idx]
                                             , path
                                             , util.inspect(node.value)), 4, options.wrapWidth));
        }
    }

    // objectdiff only supports comparing two objects.
    if (a instanceof Object && b instanceof Object) {
        var diff = objectDiff.diff(a, b);

        traverse(diff, '');

    } else if (typeof a === 'string' && typeof b === 'string') {
        result = result.concat(_generateStringDiff(a, b, options.wrapWidth));

    } else {
        if (a !== b) {
            result.push(_lineBreak(util.format(changeStr2[idx]
                                             , util.inspect(a)
                                             , util.inspect(b)), 4, options.wrapWidth));
        }
    }

    return result;
}

function printdiff(a, b, options) {
    if (!(options instanceof Object)) {
        options = {};
    }

    // We currently don't support not using colors.
    options.colors = true;
    // We currently only support writing to stdout (using `console.log()`).
    options.output = null;

    if (options.wrapWidth === undefined) {
        options.wrapWidth = consoleColumns;
    }

    if (options.output) {
        options.output.write(_generateObjectDiff(a, b, options).join('\n'));
        options.output.write('\n');
    } else {
        console.log(_generateObjectDiff(a, b, options).join('\n'));
    }
}

Object.defineProperty(printdiff, 'configStringDiff', {
    value: function(_maxChunks, _maxChunksPerLine, _maxColumns, _contextLines, _contextColumns) {
        if (_maxChunks !== undefined) {
            maxChunks = parseInt(_maxChunks, 10);
        }
        if (_maxChunksPerLine !== undefined) {
            maxChunksPerLine = parseInt(_maxChunksPerLine, 10);
        }
        if (_maxColumns !== undefined) {
            maxColumns = parseInt(_maxColumns, 10);
        }
        if (_contextLines !== undefined) {
            contextLines = parseInt(_contextLines, 10);
        }
        if (_contextColumns !== undefined) {
            contextColumns = parseInt(_contextColumns, 10);
        }
    }
});

module.exports = printdiff;
