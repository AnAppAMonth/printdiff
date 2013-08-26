
var chai = require('chai'),
    expect = chai.expect,
    chaiCommon = require('chai-common'),
    chaiHighlight = require('chai-highlight'),
    printdiff = require('../');

chai.use(chaiCommon);
chai.use(chaiHighlight);
chaiHighlight.setStyles('\x1B[36m', '\x1B[31m');

var savedLog = console.log,
    stdout;

function patchedLog(str) {
    stdout += str + '\n';
}

function patchedPrintDiff(a, b) {
    stdout = '';
    console.log = patchedLog;
    printdiff(a, b);
    console.log = savedLog;
}

// Because mocha also uses stdout, this guarantees our output begins at a fresh line.
function LOG(str) {
    console.log('\n' + str);
}

describe('When diffing strings,', function() {
    describe('pre-context lines', function() {
        it('should be fully displayed when in the middle of the text', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'a\nb\nc\nd\nex\nf\ng\nh\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.startWith('2   b\n3   c\n4   d\n\x1B[31m5   e\x1B[0m\n');
        });
        it('should partly be displayed when near text boundary', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'a\nb\ncx\nd\ne\nf\ng\nh\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.startWith('1   a\n2   b\n\x1B[31m3   c\x1B[0m\n');
        });
        it('should not be displayed at all when at text boundary', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'ax\nb\nc\nd\ne\nf\ng\nh\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.startWith('\x1B[31m1   a\x1B[0m\n');
        });
    });

    describe('post-context lines', function() {
        it('should be fully displayed when in the middle of the text', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'a\nb\nc\ndx\ne\nf\ng\nh\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.endWith('\x1B[32m    dx\x1B[0m\n5   e\n6   f\n7   g\n');
        });
        it('should partly be displayed when near text boundary', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'a\nb\nc\nd\ne\nfx\ng\nh\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.endWith('\x1B[32m    fx\x1B[0m\n7   g\n8   h\n');
        });
        it('should not be displayed at all when at text boundary', function() {
            var a = 'a\nb\nc\nd\ne\nf\ng\nh\n',
                b = 'a\nb\nc\nd\ne\nf\ng\nhx\n';

            patchedPrintDiff(a, b);
            expect(stdout).to.endWith('\x1B[32m    hx\x1B[0m\n');
        });
    });
});
