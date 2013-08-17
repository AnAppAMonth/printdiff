
var util = require('util');
var objectDiff = require('objectdiff');

/**
 * This function takes a string to be printed to the console, and formats
 * it so that when it wraps, 4 spaces are prepended to the next line to
 * make it more readable.
 *
 * The input string can contain color sequences which take spaces in the
 * string, but not in the printed output. So this function must be able
 * to deal with them.
 *
 * @param str {string} the input string.
 * @returns {string} the output string.
 * @private
 */
function _lineBreak(str) {
    var result = '';
    var consoleColumns = process.stdout.columns;

    // As an optimization, if the length of str (including color sequences)
    // doesn't exceed the console's width, this is definitely an one-liner.
    if (str.length <= consoleColumns) {
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
            if (str[i] === '\n' || ct === consoleColumns) {
                // We have finished counting a line.
                if (start) {
                    // This isn't the first line, prepend '\n' and 4 spaces.
                    result += '\n    ';
                } else {
                    // This is the first line, all subsequent lines must leave
                    // space for the 4 spaces prepended.
                    consoleColumns -= 4;
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

/**
 * This function uses the objectdiff library to diff two objects or
 * literals and generates a nice-looking diff (inspired by file diffs)
 * from the result.
 *
 * @param a {*} diff operand 1, can be object or literal.
 * @param b {*} diff operand 2, can be object or literal.
 * @param colors {boolean} whether to colorize the output.
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
                                             , util.inspect(node.added))));

        } else if (node.changed === 'removed') {
            result.push(_lineBreak(util.format(removeStr[idx]
                                             , path
                                             , util.inspect(node.value))));

        } else if (node.changed === 'added') {
            result.push(_lineBreak(util.format(addStr[idx]
                                             , path
                                             , util.inspect(node.value))));
        }
    }

    // objectdiff only supports comparing two objects.
    if (a instanceof Object && b instanceof Object) {
        var diff = objectDiff.diff(a, b);

        traverse(diff, '');

    } else {
        if (a !== b) {
            result.push(_lineBreak(util.format(changeStr2[idx]
                                             , util.inspect(a)
                                             , util.inspect(b))));
        }
    }

    return result;
}

module.exports = function(a, b) {
    console.log(_generateObjectDiff(a, b, true).join('\n'));
};
