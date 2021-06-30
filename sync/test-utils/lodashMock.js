const _ = require ('lodash')

module.exports = function () {
	_.debounce = jest.fn((fn) => {
		return fn
	})
}
