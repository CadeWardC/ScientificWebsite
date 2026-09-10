// Run with: node tools/test_gel_bands.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'gelelectrophoresis.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
function load(context, first, next) {
    const start = html.indexOf('        function ' + first);
    const end = html.indexOf('        function ' + next, start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(html.slice(start, end), context);
}
const context = vm.createContext({});
load(context, 'detectBandPeaks(', 'detectLadderBands(');
function fixture(bands, invert = false) {
    const sw = 100, sh = 500, gray = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let v = 190 + y * 0.06 + x * 0.05 + ((x * 17 + y * 7) % 5) - 2;
        for (const b of bands) if (x >= b.x0 && x < b.x1) {
            v -= b.sigma ? b.strength * Math.exp(-0.5 * ((y - b.y) / b.sigma) ** 2)
                : Math.abs(y - b.y) <= 3 ? b.strength : 0;
        }
        gray[y * sw + x] = invert ? 255 - v : v;
    }
    return { sw, sh, gray };
}
for (const inverted of [false, true]) {
    const bands = [60, 155, 340].map((y, i) => ({ y, x0: 10, x1: 40, strength: [10, 35, 100][i] }));
    const found = context.detectBandPeaks(fixture(bands, inverted), 0, 0.5);
    assert.equal(found.length, 3);
    found.forEach((b, i) => assert.ok(Math.abs(b.center - (bands[i].y + 0.5) / 500) < 0.005));
}
assert.equal(context.detectBandPeaks(fixture([]), 0, 1).length, 0, 'Uneven blank background');
assert.equal(context.detectBandPeaks(fixture([{ y: 250, x0: 0, x1: 50, strength: 60 }]), 0, 0.5).length, 1, 'Single full-width band');
assert.equal(context.detectBandPeaks(fixture([{ y: 250, x0: 55, x1: 95, strength: 60 }]), 0, 0.5).length, 0, 'Adjacent lane excluded');
const diffuse = [100, 145, 190, 245, 295].map(y => ({ y, x0: 0, x1: 50, strength: 30, sigma: 13 }));
assert.equal(context.detectBandPeaks(fixture(diffuse), 0, 0.5).length, 5, 'Overlapping diffuse bands separated');

// Editing an existing AutoWell result must not clear its boundaries.
const elements = { splitterModal: { style: {} }, splitImageToggle: { checked: true } };
const split = { splitPositions: [0.2, 0.55], removedIndices: [1], addGaps: true };
const ui = vm.createContext({
    document: { getElementById: id => elements[id], querySelectorAll: () => [{ value: 'sample' }, { value: 'ladder' }, { value: 'Ladder' }] },
    originalCroppedImageSrc: 'fixture', savedSplitState: split, currentWellCount: 3,
    initSplitter: () => { ui.opened = true; }, alert: () => { throw Error('Unexpected alert'); }
});
load(ui, 'editWellSplits(', 'toggleSplitImage(');
ui.editWellSplits();
assert.equal(elements.splitterModal.style.display, 'flex');
assert.equal(ui.savedSplitState, split);
assert.ok(ui.opened);
load(ui, 'findLadderWellIndex(', 'autoAlignLadder(');
assert.equal(ui.findLadderWellIndex(), 2, 'Removed ladder well excluded');
assert.equal(ui.getWellSourceRange(2).start, 0.55);
async function testPicker() {
    const pickerElements = {
        bandDetectionStatus: {},
        autoBandSensitivity: { value: '3' }
    };
    const picker = vm.createContext({
        document: { getElementById: id => pickerElements[id] },
        originalCroppedImageSrc: 'fixture', savedSplitState: split, currentWellCount: 3,
        biomarkers: [], previewGelHeightRatio: 0.8,
        activeWellPositions: [{ index: 2, centerPercent: 0.75 }],
        detectLadderBands: async () => [0.2, 0.3, 0.5], renderBiomarkers: () => {},
        crypto: require('node:crypto')
    });
    load(picker, 'getWellSourceRange(', 'autoAlignLadder(');
    load(picker, 'clampBandPct(', 'addOfInterestMarker(');
    picker.renderWellPicker = () => {};
    await picker.autoPickInterestBands(2);
    assert.equal(picker.biomarkers.length, 3);
    assert.equal(picker.biomarkers[0].xPct, 75, 'Anchor uses displayed well after removals/gaps');
    assert.ok(Math.abs(picker.biomarkers[0].yPct - 16) < 1e-8, 'Grouping space excluded from band height');
    picker.biomarkers[0].name = 'My protein';
    await picker.autoPickInterestBands(2);
    assert.equal(picker.biomarkers.length, 3, 'Repeated detection does not duplicate bands');
    assert.equal(picker.biomarkers[0].name, 'My protein', 'User labels preserved');
    picker.detectLadderBands = async () => { picker.originalCroppedImageSrc = 'changed'; return [0.7]; };
    await picker.autoPickInterestBands(2);
    assert.equal(picker.biomarkers.length, 3, 'Stale detection discarded');
    assert.match(pickerElements.bandDetectionStatus.textContent, /changed/);
}
// A missing upper rung must never shift all following size labels.
load(context, 'matchLadderBands(', 'autoAlignLadder(');
const sizes = [{ text: '245', pos: 10 }, { text: '100', pos: 30 }, { text: '75', pos: 50 }, { text: '25', pos: 80 }];
const mapping = context.matchLadderBands(sizes, [0.31, 0.5, 0.81]);
assert.equal(mapping.length, 4);
assert.equal(mapping[0], null);
assert.equal(mapping[1], 0.31);
assert.equal(mapping[2], 0.5);
assert.equal(mapping[3], 0.81);
load(context, 'getLadderMarkerData(', 'setLadderPosition(');
const proteinSizes = context.getLadderMarkerData('protein');
assert.equal(proteinSizes.length, 12, 'Every existing protein size retained');
assert.equal(context.matchLadderBands(proteinSizes, []).length, 12, 'Even an empty lane retains all size slots');

// Object-fit containment must use actual pixels, not the surrounding image box.
const geometry = vm.createContext({ document: { getElementById: () => ({
    naturalWidth: 800, naturalHeight: 200,
    getBoundingClientRect: () => ({ left: 10, top: 100, width: 800, height: 450 })
}) }});
load(geometry, 'getRenderedGelRect(', 'adjustPreviewLayout(');
const rect = geometry.getRenderedGelRect();
assert.equal(rect.top, 225);
assert.equal(rect.height, 200);
assert.equal(rect.left, 10);
assert.equal(rect.width, 800);

const targets = [];
const overlay = { hidden: false, appendChild: button => targets.push(button) };
const clicks = [];
const clickContext = vm.createContext({
    selectedBandWell: null, previewGelHeightRatio: 0.8,
    activeWellPositions: [{ index: 0, startX: 0, width: 20 }, { index: 2, startX: 40, width: 60 }],
    document: {
        getElementById: id => id === 'wellPickOverlay' ? overlay : { naturalWidth: 100 },
        querySelectorAll: () => [{ value: 'A' }, { value: 'removed' }, { value: 'B' }],
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener(event, fn) { this.click = fn; } })
    },
    positionWellPicker() {}, autoPickInterestBands: index => clicks.push(index)
});
load(clickContext, 'renderWellPicker(', 'positionWellPicker(');
clickContext.renderWellPicker();
assert.equal(targets.length, 2);
assert.equal(targets[1].style.left, '40%');
assert.equal(targets[1].style.width, '60%');
assert.equal(targets[1].style.height, '80%');
targets[1].click();
assert.equal(clicks[0], 2, 'Click selects the original source well, not its displayed ordinal');

testPicker().then(() => console.log('PASS: script syntax, band separation, lane isolation, AutoWell editing, removed-well mapping, picker anchors, duplicate prevention, stale detection'))
    .catch(error => { console.error(error); process.exitCode = 1; });
