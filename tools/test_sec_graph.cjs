// Run with: node tools/test_sec_graph.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'size_exclusion_graphing.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
scripts.forEach(script => new vm.Script(script));

class Element {
    constructor() {
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.value = '';
        this.checked = false;
        this.classList = { toggle() {} };
    }
    set innerHTML(value) { this.children = []; this.html = value; }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this[name] = value; }
    getContext() { return {}; }
}
const elements = Object.fromEntries([
    'csvFileInput', 'secChart', 'graphTitle', 'xAxisLabel', 'yAxisLabel',
    'showFractions', 'showGridlines', 'snapZoom', 'fractionVolume', 'fractionStart',
    'seriesTogglesContainer', 'fractionGroupsPanel', 'groupList', 'toggleAKTA',
    'toggleBioRad', 'fractionVolumeRow'
].map(id => [id, new Element()]));
const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
const document = {
    createElement: () => new Element(),
    getElementById: id => elements[id] || descendants(elements.seriesTogglesContainer).find(el => el.id === id),
    querySelector: selector => {
        const id = selector.match(/label\[for="(.*?)"\]/)?.[1];
        return descendants(elements.seriesTogglesContainer).find(el => el.htmlFor === id);
    }
};
class Chart {
    static register() {}
    constructor(ctx, config) {
        this.data = config.data;
        this.options = config.options;
        this.scales = { x: { min: 0, max: 2, width: 600 } };
    }
    update() { this.updates = (this.updates || 0) + 1; }
    destroy() { this.destroyed = true; }
    zoomScale(axis, bounds) { Object.assign(this.scales[axis], bounds); }
    resetZoom() { Object.assign(this.scales.x, { min: 0, max: 2 }); }
}
const context = vm.createContext({
    document, Chart, console,
    alert: message => { throw new Error(message); },
    prompt: () => 'Renamed trace'
});
vm.runInContext(scripts.find(script => script.includes('let myChart')), context);
const read = expression => vm.runInContext(expression, context);
const plain = value => JSON.parse(JSON.stringify(value));

async function test() {
    elements.snapZoom.checked = true;
    context.setInstrument('biorad');
    elements.fractionStart.value = '0.25';
    elements.csvFileInput.files = [{ text: async () => [
        'Sample',
        'UV1_volume,UV1_mAU,UV2_volume,UV2_mAU,UV3_volume,UV3_mAU,UV4_volume,UV4_mAU',
        '0,10,0,20,0,30,0,40',
        '1,20,1,30,1,40,1,50',
        '2,15,2,25,2,35,2,45'
    ].join('\n') }];
    await context.plotGraph();
    const chart = read('myChart');
    assert.deepEqual(plain(chart._fractions.map(f => f.x)), [0.25, 0.75, 1.25, 1.75]);
    assert.equal(chart.options.plugins.fractionLines.fractions.length, 0, 'Fractions initially hidden');

    Object.assign(chart.scales.x, { min: 0.38, max: 1.1 });
    chart.options.plugins.zoom.zoom.onZoomComplete({ chart });
    assert.equal(chart.scales.x.min, 0.25);
    assert.equal(chart.scales.x.max, 1.25, 'Snap to fractional volumes even with labels hidden');
    assert.equal(chart.options.scales.x.ticks.stepSize, undefined, 'No whole-mL tick forcing');
    elements.snapZoom.checked = false;
    context.updateSnapZoom();
    assert.equal(chart.scales.x.min, 0.38);
    assert.equal(chart.scales.x.max, 1.1, 'Exact selection restored');
    elements.snapZoom.checked = true;
    context.updateSnapZoom();
    assert.equal(chart.scales.x.max, 1.25);
    context.resetZoom();
    assert.equal(chart._exactFractionZoom, undefined);
    assert.equal(chart.scales.x.max, 2);

    const bounds = context.getFractionZoomBounds;
    const irregular = [{ x: 1.8 }, { x: 0.2 }, { x: 0.65 }, { x: 0.65 }, { x: NaN }];
    assert.deepEqual(plain(bounds(0.4, 0.9, irregular)), { min: 0.2, max: 1.8 });
    assert.deepEqual(plain(bounds(0.3, 0.4, irregular)), { min: 0.2, max: 0.65 }, 'Single fraction');
    assert.deepEqual(plain(bounds(0.1, 2, irregular)), { min: 0.1, max: 2 }, 'Outside fraction span');
    assert.deepEqual(plain(bounds(0.2, 0.65, irregular)), { min: 0.2, max: 0.65 }, 'Already aligned');
    assert.deepEqual(plain(bounds(0.3, 0.4, [])), { min: 0.3, max: 0.4 }, 'No fractions');
    assert.deepEqual(plain(bounds(0.3, 0.4, [{ x: 0.2 }])), { min: 0.2, max: 0.4 }, 'One known boundary');

    const datasets = chart.data.datasets.slice();
    context.toggleSeries(1, false);
    const color = document.getElementById('color-series-2');
    color.value = '#123456';
    color.oninput();
    context.renameSeries(2, read('currentDatasetsInfo[2].label'));
    let rows = elements.seriesTogglesContainer.children;
    assert.equal(rows[0].children[5].disabled, true, 'First up button disabled');
    assert.equal(rows[3].children[6].disabled, true, 'Last down button disabled');
    rows[2].children[5].onclick();
    elements.seriesTogglesContainer.children[1].children[5].onclick();
    assert.equal(elements.seriesTogglesContainer.children[0].children[2].textContent, 'Renamed trace');
    assert.equal(chart.options.scales['y-axis-2'].position, 'left');
    assert.equal(chart.options.scales['y-axis-2'].weight, 0, 'Top series on inner left axis');
    assert.equal(chart.options.scales['y-axis-0'].position, 'right');
    assert.equal(chart.options.scales['y-axis-1'].weight, 1);
    datasets.forEach((dataset, index) => assert.equal(chart.data.datasets[index], dataset, 'Data stays attached'));
    assert.equal(chart.data.datasets[2].borderColor, '#123456');
    assert.equal(chart.options.scales['y-axis-2'].title.text, 'Renamed trace');
    assert.equal(chart.data.datasets[1].hidden, true);
    assert.equal(document.getElementById('toggle-series-1').checked, false);
    assert.equal(chart.data.datasets[3].hidden, true);

    elements.showFractions.checked = true;
    context.updateShowFractions();
    assert.equal(chart.options.plugins.fractionLines.fractions.length, 4);
    assert.equal(read('myChart'), chart, 'Showing fractions preserves the chart and edits');
    assert.equal(chart.destroyed, undefined);
    elements.showFractions.checked = false;
    context.updateShowFractions();
    assert.equal(chart.options.plugins.fractionLines.fractions.length, 0);
    assert.equal(chart._fractionLabelAreas.length, 0, 'Hidden fraction labels cannot be clicked');

    const order = plain(read('seriesOrder'));
    await context.plotGraph();
    assert.deepEqual(plain(read('seriesOrder')), order, 'Replot preserves axis order');
    assert.equal(read("myChart.options.scales['y-axis-2'].position"), 'left');
    assert.equal(read('myChart.data.datasets[2].borderColor'), '#123456');
    context.clearData();
    assert.equal(read('myChart'), null);
    assert.equal(read('seriesOrder.length'), 0);
    assert.equal(read('currentDatasetsInfo.length'), 0);
    console.log('SEC graph checks passed: fraction snapping, exact bounds, axis reordering, edits, and reset.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
