/**
 * Report includes:
 *  - Duplicate ID
 *  - Health check status
 *  - Commit status
 *  - Exception when run query of commit
 * @param orm
 */
const COMMIT_TYPE = {
	HEATH_CHECK: 'health-check',
}

const syncReport = function (orm) {
	/**
	 * Health check report
	 */
	orm.on('commit:report:health-check', async (name, status, date) => {
		const nearestReport = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK,
			name
		}).sort({ date: -1 }).limit(1)
		if (nearestReport.status === status)
			return
		await orm('CommitReport').create({
			type: COMMIT_TYPE.HEATH_CHECK,
			name,
			status,
			date
		})
	})
	/**
	 * Duplicate ID report
	 */
	orm.on('commit:report:getDuplicateID', async function () {
		this.value = await orm('Commit').aggregate([{ $group: { '_id': '$id', 'count': { $sum: 1 }} }, { $match: { 'count': { $gt: 1 } } }])
	})

	orm.on('commit:report:getReport', async function () {
		const { value: duplicateId } = await orm.emit('commit:report:getDuplicateID')
		const healthCheckData = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK
		}).sort({ date: -1 }).limit(100)
		const commitData = await orm('CommitData').findOne()

		this.value = {
			duplicateId,
			healthCheckData,
			commitData
		}
	})
}

module.exports = syncReport
