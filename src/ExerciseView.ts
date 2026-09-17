import * as vscode from 'vscode'
import { Exercise } from './api/models'
import { Biro3Client } from './api/Biro3Client'
import { log } from './extension'
import { rateLimiter, getNonce, handleError, sleep } from './utils'
// @ts-ignore
const marked: typeof import('marked') = require('marked')

export default class ExerciseView {
    public static readonly viewType = 'exercise'

    public disposed: boolean
    private readonly panel: vscode.WebviewPanel
    private readonly extensionUri: vscode.Uri
    private readonly client: Biro3Client
    private readonly onDispose: () => void

    private exerciseId: number | null
    private lock: Promise<void>
    private disposables: Array<vscode.Disposable> = []
    //@ts-ignore
    private readonly refreshHtmlLimited: (v: Exercise) => Promise<void>
    private showConfetti: boolean
    private showEvaluatingCat: boolean
    private submissionVisibilities: Record<number, boolean>

    public static create(extensionUri: vscode.Uri, client: Biro3Client, exerciseId: number, onDispose: () => void) {
        const panel = vscode.window.createWebviewPanel(
            ExerciseView.viewType,
            `Exercise ${exerciseId}`,
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
            },
            getWebviewOptions(extensionUri)
        )

        return new ExerciseView(panel, extensionUri, client, exerciseId, onDispose)
    }

    constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: Biro3Client, exerciseId: number | null, onDispose: () => void) {
        this.disposed = false
        this.panel = panel
        this.extensionUri = extensionUri
        this.exerciseId = exerciseId
        this.lock = Promise.resolve()
        this.client = client
        this.onDispose = onDispose
        this.showConfetti = false
        this.showEvaluatingCat = true
        this.submissionVisibilities = {}

        this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon-small.svg')

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

        this.panel.onDidChangeViewState(async () => {
            if (this.panel.visible) {
                await this.update(false)
            }
        }, null, this.disposables)

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh-submissions':
                        if (this.exerciseId === null) { return }
                        log.debug(`Refreshing submissions for exercise webview ${exerciseId}`)
                        await this.client.withReauth(() => this.client.smartGetExercise(this.exerciseId ?? 0))
                        await this.update(false)
                        return
                    case 'fetch-reports':
                        if (this.exerciseId === null) { return }
                        log.debug(`Refreshing reports for exercise webview ${exerciseId}`)
                        await this.client.withReauth(() => this.client.getReports(message.evaluationId))
                        await this.update(false)
                        return
                    case 'open-file':
                        if (this.exerciseId === null) { return }
                        vscode.commands.executeCommand('vscbiro3.openSubmittedFile', message.submissionId, message.filename)
                        return
                    case 'open-starter-file':
                        if (this.exerciseId === null) { return }
                        vscode.commands.executeCommand('vscbiro3.openStarterFile', this.exerciseId, message.filename, message.fileId)
                        return
                    case 'upload-submission':
                        if (this.exerciseId === null) { return }
                        vscode.commands.executeCommand('vscbiro3.submit')
                        return
                    case 'next-exercise':
                        if (this.exerciseId === null) { return }
                        vscode.commands.executeCommand('vscbiro3.selectExercise', 'next')
                        return
                    case 'previous-exercise':
                        if (this.exerciseId === null) { return }
                        vscode.commands.executeCommand('vscbiro3.selectExercise', 'previous')
                        return
                    case 'stop-confetti':
                        this.showConfetti = false
                        return
                    case 'show-confetti':
                        this.showConfetti = true
                        return
                    case 'toggle-submission-visibility':
                        this.submissionVisibilities[message.submissionId] = message.visible
                        return
                }
            },
            null,
            this.disposables
        )

        this.refreshHtmlLimited = rateLimiter((v: Exercise) => this.refreshHtml(v), 500)
    }

    public dispose() {
        this.disposed = true

        this.panel.dispose()

        while (this.disposables.length) {
            const x = this.disposables.pop()
            if (x) {
                x.dispose()
            }
        }

        this.onDispose()
    }

    public reveal(exerciseId?: number | undefined, clearContent?: boolean | undefined) {
        log.debug(`Revealing exercise webview`, exerciseId, clearContent)
        this.panel.reveal(undefined, true)

        if (exerciseId === undefined) {
            this.update(true)
        } else if (this.exerciseId === exerciseId) {
            this.update(clearContent === undefined ? true : clearContent)
        } else {
            this.exerciseId = exerciseId
            this.submissionVisibilities = {}
            this.showConfetti = false
            this.update(true)
        }
    }

    public async update(clearContent: boolean) {
        if (this.exerciseId === null) {
            return
        }

        log.debug(`Updating exercise webview ${this.exerciseId}`, clearContent)
        await this.lock
        let unlock: () => void = () => {
            log.warn(`Failed to unlock`)
            this.lock = Promise.resolve()
        }
        this.lock = new Promise(v => unlock = v)

        try {
            if (clearContent) {
                this.panel.title = vscode.l10n.t('Loading...')
                this.panel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource};">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'reset.css'))}" rel="stylesheet">
                    <link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'vscode.css'))}" rel="stylesheet">
                    <link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'main.css'))}" rel="stylesheet">
                    <title>Meow</title>
                </head>
                <body>
                    <div class="loading-panel">
                        ${vscode.l10n.t('Loading...')}
                    </div>
                </body>
                `
            }

            const existing = this.client.exercises[this.exerciseId]
            const exercise = await this.client.withReauth(() => this.client.smartGetExercise(this.exerciseId!))
            let didNotChange = false
            if (!clearContent && existing && JSON.stringify(exercise) === JSON.stringify(existing)) {
                didNotChange = true
            }

            const tasks: Array<Promise<any>> = []
            let isUnderEvaluation = false
            for (const submission of exercise.submissions) {
                if (submission.status === "UNDER_EVALUATION") {
                    isUnderEvaluation = true
                }

                tasks.push(this.client.withReauth(() => this.client.getSubmissionFiles(submission.submissionId)))
                for (const evaluation of submission.evaluations) {
                    tasks.push(this.client.withReauth(() => this.client.getReports(evaluation.evaluationId)))
                }
            }

            if (isUnderEvaluation) {
                log.debug(`Exercise webview will refresh later`)

                Promise.allSettled([...tasks, sleep(1000)])
                    .then(() => {
                        if (this.exerciseId !== exercise.assignedExerciseId) {
                            log.warn(`Exercise webview changed, will not refresh automatically`)
                            return
                        }

                        log.debug(`Exercise webview is automatically refreshing`)
                        this.update(false)
                    })
                    .catch(error => {
                        log.error(String(error))
                        handleError(error)
                    })

                if (didNotChange) {
                    log.info(`Skipping updating exercise HTML: Exercise hasn't change`)
                    return
                }
            } else {
                for (const task of tasks) {
                    if (!await task.isFinished()) task.then(() => this.refreshHtmlLimited(exercise))
                }
            }

            {
                const t = this.client.getUserSetting('student_task_show_stories', true)
                    .then(async res => {
                        if (!res) return

                        for (const taskImage of exercise.taskImages) {
                            const t = this.client.withReauth(() => this.client.getTaskImage(exercise.assignedExerciseId, taskImage.taskimageId))
                            if (!await t.isFinished()) t.then(() => this.refreshHtmlLimited(exercise))
                        }
                    })
                    .catch(error => {
                        log.error(String(error))
                        handleError(error)
                    })
                if (!await t.isFinished()) t.then(() => this.refreshHtmlLimited(exercise))
            }

            if (this.exerciseId !== exercise.assignedExerciseId) {
                log.trace(`Exercise id changed, skipping updating webview HTML (1)`)
                return
            }

            this.panel.title = `${exercise.indexInTaskList}. ${exercise.displayName}`
            this.refreshHtmlLimited(exercise)
        } catch (error) {
            log.error(String(error))
            handleError(error)
        } finally {
            unlock()
        }
    }

    private refreshHtml(exercise: Exercise) {
        if (this.exerciseId !== exercise.assignedExerciseId) {
            log.trace(`Exercise id changed, skipping updating webview HTML (2)`)
            return
        }

        const showStory = 'student_task_show_stories' in this.client.userSettings ? this.client.userSettings['student_task_show_stories'] : true

        log.debug(`Refreshing exercise webview HTML`)

        const assignment = this.client.assignmentOfExercise(exercise.assignedExerciseId!)

        let compiledDescription = exercise.description
        for (const taskImage of exercise.taskImages) {
            const data = this.client.taskImages[`${exercise.assignedExerciseId}-${taskImage.taskimageId}`]
            if (data) {
                compiledDescription = compiledDescription.replace(`src="${taskImage.filename}"`, `src="${data}"`)
            } else {
                compiledDescription = compiledDescription.replace(new RegExp(`<img\\s+class="story"\\s+alt=".+"\\s+src="${taskImage.filename}"\\s*\\/?>`), '')
            }
        }

        const goodSubmission = exercise.score >= exercise.maxScore ? exercise.submissions.find(v => v.score >= exercise.maxScore) : undefined

        const nonce = getNonce()

        this.panel.webview.html =
            `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; img-src ${this.panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'reset.css'))}" rel="stylesheet">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'vscode.css'))}" rel="stylesheet">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'main.css'))}" rel="stylesheet">
				${(showStory ? '' : `<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'hide-story.css'))}" rel="stylesheet">`)}
				<title>Meow</title>
			</head>
			<body>
                <div id="confetti" class="${(exercise.score >= exercise.maxScore && this.showConfetti) ? 'confetti' : ''}"></div>
                <div class="title-bar">
                    ${(() => {
                if (exercise.indexInTaskList <= 1) return ''
                return '<div class="button button-secondary" id="previous-button"><svg xmlns="http://www.w3.org/2000/svg" height="24px" width="24px" viewBox="0 -960 960 960" fill="currentColor"><path d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z"/></svg></div>'
            })()}
    				<h1>${exercise.indexInTaskList}. ${exercise.displayName} (${exercise.maxScore} pont)</h1>
                    ${(() => {
                if (assignment && exercise.indexInTaskList >= assignment.exerciseStatuses.length) return ''
                return '<div class="button button-secondary" id="next-button"><svg xmlns="http://www.w3.org/2000/svg" height="24px" width="24px" viewBox="0 -960 960 960" fill="currentColor"><path d="M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z"/></svg></div>'
            })()}
                </div>
                ${(() => {
                if (!assignment) return ''

                const startTime = Date.parse(assignment.assignmentDetails.startTime)
                const endTime = Date.parse(assignment.assignmentDetails.endTime)
                const now = Date.now()

                if (now < startTime) {
                    return `
                        <div class="assignment-locked">
                            <h2>${vscode.l10n.t('The assignment will be available in {0} ms', startTime - now)}</h2>
                        </div>
                    `
                } else if (now < endTime) {
                    return ''
                } else {
                    return `
                        <div class="assignment-locked">
                            <h2>${vscode.l10n.t('The deadline for the task has passed!')}</h2>
                        </div>
                    `
                }
            })()}
                <div class="debug">
                    <!--<b>${vscode.l10n.t('Type')}:</b> ${vscode.l10n.t(exercise.type)} <br>-->
                    <b>${vscode.l10n.t('Difficulty')}:</b> ${"⭐".repeat(Math.round(Math.max(1, Math.min(10, exercise.difficultyLevel))))} <br>
                    <b>${vscode.l10n.t('Expected file format')}:</b> ${exercise.expectedFileFormat} <br>
                </div>
				<div class="description">
					${marked.parse(compiledDescription, { async: false })}
				</div>
                ${(() => {
                if (!exercise.starterFiles?.length) return ''
                return `
                    <h2>${vscode.l10n.t('Starter files')}</h2>
                    <div class="starter-files">
                        ${exercise.starterFiles.map(v => `
                            <div class="starter-file">
                                <span class="link starter-file-link" data-fileid=${v.starterFileId} data-filename=${v.filename}>${v.filename}</span>
                            </div>
                        `)}
                    </div>
                `
            })()}
				<h2>${vscode.l10n.t('Submissions')} (${exercise.submissions.length}/${exercise.uploadLimit})</h2>
				<div class="submissions">
                    <a class="button" id="submit-file-button" role="button" aria-disabled="${(exercise.submissions.length < exercise.uploadLimit) ? 'false' : 'true'}" disabled="${(exercise.submissions.length < exercise.uploadLimit) ? 'false' : 'true'}">${vscode.l10n.t('Submit File')}</a>
					${exercise.submissions.map(v => `
						<div class="submission${(this.submissionVisibilities[v.submissionId] === false || (!this.submissionVisibilities[v.submissionId] && v.submissionId !== exercise.submissions[exercise.submissions.length - 1].submissionId)) ? ' hidden' : ''}" id="submission-${v.submissionId}">
                            ${v.status === 'UNDER_EVALUATION' ? `
                                <h3>${v.name} <span class="submission-time time" title="${new Date(Date.parse(v.submissionTime)).toLocaleString()}">${v.submissionTime}</span></h3>
                                <div class="evaluations under-evaluation">
                                    ${this.showEvaluatingCat ? `<img src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'loading2.gif'))}" width=48 height=48>` : ''}
                                    <span>${vscode.l10n.t("Under evaluation ...")}</span>
                                </div>
                                ` : `
                                <div class="submission-title">
                                    <h3>${v.name} <span class="submission-score score ${(v.status === 'EVALUATED' && v.score >= exercise.maxScore) ? 'success' : v.score === 0 ? 'fail' : 'almost'}">${v.score}/${exercise.maxScore} ${vscode.l10n.t('points')}</span> <span class="submission-time time" title="${new Date(Date.parse(v.submissionTime)).toLocaleString()}">${v.submissionTime}</span>${v.submissionId === goodSubmission?.submissionId ? ` <span id="show-confetti">🎉</span>` : ''}</h3>
                                    <span>...</span>
                                </div>
                                <div class="evaluations">
                                    ${v.evaluations.map(v => `
                                        ${v.message}
                                        ${this.client.reports[v.evaluationId] ? `<div class="reports">
                                            ${this.client.reports[v.evaluationId].map(v => typeof v.content === 'string' ? `
                                                <pre class="report report-message">${v.content}</pre>
                                            ` : `
                                                <div class="report">
                                                    <!--${v.content.report_type}<br>-->
                                                    ${v.content.tests.map(v => `
                                                        <div>
                                                            <h3>
                                                                ${v.name}${v.score === undefined ? '' : ` - <span class="score ${v.max ? v.score >= v.max ? 'success' : v.score === 0 ? 'fail' : 'almost' : ''}">${v.score}${v.max ? `/${v.max}` : ''} ${vscode.l10n.t('points')}</span>`}
                                                            </h3>
                                                            <div>
                                                                ${v.tests.map(w => `
                                                                    <div>
                                                                        ${w.name === v.name && v.tests.length === 1 ? '' : `
                                                                            <h4>
                                                                                ${w.name}${w.max ? ` - <span class="score ${w.score >= w.max ? 'success' : w.score === 0 ? 'fail' : 'almost'}">${w.score}/${w.max} ${vscode.l10n.t('points')}</span>` : ''}
                                                                            </h4>
                                                                        `}
                                                                        ${w.message ? `<pre class="report-message">${w.message}</pre>` : ''}
                                                                    </div>
                                                                `).join('')}
                                                            </div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                            `).join('')}
                                        </div>` : `${vscode.l10n.t('No reports')}`}
                                    `).join('')}
                                </div>
                                `
                }
                            ${this.client.submissionFiles[v.submissionId] ? `<div class="files">
                                ${this.client.submissionFiles[v.submissionId].map(w => `
                                    <div class="file">
                                        <span class="link file-link" data-submission=${v.submissionId} data-filename="${w.filename}">${w.filename}</span>
                                    </div>
                                `).join('')}
                            </div>` : `<div class="files">${vscode.l10n.t('No files')}</div>`}
						</div>
					`).reverse().join('')}
				</div>

                <script type="application/json" id="l10n">${JSON.stringify({
                    'sec': vscode.l10n.t('seconds ago'),
                    'min': vscode.l10n.t('minutes ago'),
                    'hour': vscode.l10n.t('hours ago'),
                    'day': vscode.l10n.t('days ago'),
                    'now': vscode.l10n.t('just now'),
                })}</script>
				<script nonce="${nonce}" src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'main.js'))}"></script>
			</body>
			</html>`
    }
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'assets')],
        enableScripts: true,
    }
}
