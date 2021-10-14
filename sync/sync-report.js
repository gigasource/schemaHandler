const AwaitLock = require('await-lock').default
const jsonFn = require('json-fn')
const dayjs = require('dayjs')

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
	WRONG_COMMIT: 'wrong-commit',
	COMMIT_DATA: 'commit-data',
	ERROR_ID: 'error-id',
	EXEC_ERROR: 'exec-error',
	VALIDATION_FAILED: 'validation-failed'
}

const syncReport = function (orm) {
	let prevId
	const fnLock = new AwaitLock()

	orm.disableReport && orm.disableReport()

	orm.disableReport = function () {
		clearInterval(interval)
		off1()
		off2()
		off3()
		off4()
		off5()
		off6()
		off7()
	}

	const interval = setInterval(async () => {
		const commitData = await orm('CommitData').findOne()
		await orm('CommitReport').create({
			type: COMMIT_TYPE.COMMIT_DATA,
			commitData,
			date: new Date()
		})
		const clearDate = dayjs().subtract(7, 'day').toDate()
		await orm('CommitReport').deleteMany({
			type: COMMIT_TYPE.COMMIT_DATA,
			date: {
				'$lte': clearDate
			}
		})
	}, 60 * 1000 * 3)

	/**
	 * This must be called before lower id commits are deleted
	 */
	const off1 = orm.on('commit:handler:finish', -1, async (commit) => {
		await fnLock.acquireAsync()
		if (!prevId) {
			const lastHighestIdCommit = (await orm('Commit').find({ id: { $lt: commit.id } }).sort({ id: -1 }).limit(1))
			if (!lastHighestIdCommit.length) {
				fnLock.release()
				return
			}
			prevId = lastHighestIdCommit[0].id
		}

		if (commit.prevId) {
			if (commit.prevId !== prevId) {
				await orm('CommitReport').create({
					type: COMMIT_TYPE.WRONG_COMMIT,
					wrongId: prevId,
					currentId: commit.id,
					prevId: commit.prevId
				})
			}
		} else {
			await orm('Commit').updateOne({id: commit.id}, { prevId })
		}
		prevId = commit.id
		fnLock.release()
	}).off
	/**
	 * Health check report
	 */
	const off2 = orm.on('commit:report:health-check', async (name, status, date) => {
		const nearestReport = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK,
			name
		}).sort({ date: -1 }).limit(1)
		if (nearestReport.length && nearestReport[0].status === status)
			return
		await orm('CommitReport').create({
			type: COMMIT_TYPE.HEATH_CHECK,
			name,
			status,
			date
		})
	}).off
	/**
	 * Duplicate ID report
	 */
	const off3 = orm.on('commit:report:getDuplicateID', async function () {
		this.value = await orm('Commit').aggregate([{ $group: { '_id': '$id', 'count': { $sum: 1 }} }, { $match: { 'count': { $gt: 1 } } }])
	}).off

	/**
	 * Commit id error
	 */
	const off4 = orm.on('commit:report:errorId', async function (wrongId, realId) {
		await orm('CommitReport').create({
			type: COMMIT_TYPE.ERROR_ID,
			wrongId,
			realId,
			date: new Date()
		})
	}).off

	/**
	 * Commit execution error
	 */
	const off5 = orm.on('commit:report:errorExec', async function (commitId, message, isFake = false) {
		await orm('CommitReport').create({
			type: COMMIT_TYPE.EXEC_ERROR,
			commitId,
			message,
			date: new Date(),
			isFake
		})
	}).off

	/**
	 * validation failed report
	 */
	const off6 = orm.on('commit:report:validationFailed', async function (commit, sum) {
		await orm('CommitReport').create({
			type: COMMIT_TYPE.VALIDATION_FAILED,
			commitId: commit.id,
			expectedSum: commit._cnt,
			realSum: sum
		})
	}).off

	const off7 = orm.on('commit:report:getReport', async function (dateTo) {
		const { value: duplicateId } = await orm.emit('commit:report:getDuplicateID')
		const healthCheckData = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(300)
		const commitData = await orm('CommitReport').find({
			type: COMMIT_TYPE.COMMIT_DATA,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(600)
		commitData.push(await orm('CommitData').findOne())
		const wrongCommit = await orm('CommitReport').find({
			type: COMMIT_TYPE.WRONG_COMMIT
		})
		const execError = await orm('CommitReport').find({
			type: COMMIT_TYPE.EXEC_ERROR,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(100)
		const validationFailed = await orm('CommitReport').find({
			type: COMMIT_TYPE.VALIDATION_FAILED,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(100)

		this.value = {
			duplicateId,
			healthCheckData,
			commitData,
			wrongCommit,
			execError,
			validationFailed
		}
	}).off
}

module.exports = syncReport
