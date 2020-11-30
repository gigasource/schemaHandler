const _ = require('lodash');

function renderPivotTable(pivot, items) {
  const result = {data: items};
  this.items = items;

  result.reducer = pivot.reducers[0];
  result.reducers = pivot.reducers;

  result.reducerType = pivot.reducers[0].resultType;

  result.rowFields = pivot.rows;
  result.colFields = pivot.columns;
  if (pivot.filter) {
    result.filter = pivot.filter;
  }

  let fields = result.colFields.concat(result.rowFields);
  if (result.filter) fields = result.filter.concat(fields);

  let jsonData = _(items).groupBy(item => {
    const arr = [];
    for (const field of fields) {
      arr.push(field.getter(item));
    }
    return arr.join(',');
  }).mapValues(items => {
    const _result = result.reducers.reduce((obj, reducer) => {
      let reduceResult = _.reduce(items, reducer.fn, reducer.initValue ? eval(reducer.initValue) : 0);
      if (reducer.format) reduceResult = reducer.format(reduceResult)
      return _.assign(obj, {[reducer.name]: reduceResult});
    }, {});
    if (result.reducers.length === 1) return _result[result.reducers[0].name];
    return _result;
  }).thru(groups => {
    const res = {};
    for (const k of Object.keys(groups)) {
      if (result.reducerType === 'array' && groups[k].length === 0) continue;
      _.setWith(res, k.split(','), groups[k], Object);
    }
    return res;
  }).value();
  if (fields.length === 0) jsonData = jsonData[''];

  return {renderData: result, jsonData};
}

const items = [
  {name: 'A1', price: 10, quantity: 1, tax: 7, group: 'G1', takeAway: true},
  {name: 'A2', price: 10, quantity: 1, tax: 19, group: 'G2', takeAway: true},
  {name: 'A3', price: 10, quantity: 1, tax: 7, group: 'G1', takeAway: true},
  {name: 'A4', price: 10, quantity: 1, tax: 7, group: 'G2', takeAway: true},
  {name: 'A5', price: 10, quantity: 1, tax: 7, group: 'G1'},
  {name: 'A6', price: 10, quantity: 1, tax: 19, group: 'G2'},
  {name: 'A7', price: 10, quantity: 1, tax: 19, group: 'G1'},
  {name: 'A8', price: 10, quantity: 1, tax: 19, group: 'G2'},
  {name: 'A9', price: 10, quantity: 1, tax: 7, group: 'G1'}
]

const pivot = {
  rows: [{label: 'tax', getter: i => i.tax}],
  columns: [{label: 'group', getter: i => i.group}],
  reducers: [{fn: (sum, i) => sum + i.quantity, name: 'quantity'}]
}
const result = renderPivotTable(pivot, items);

module.exports = {
  renderPivotTable
}
