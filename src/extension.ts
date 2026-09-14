import path from 'path'
import * as vscode from 'vscode'
import { Biro3Client } from './api/Biro3Client'
import { BiroExplorerProvider } from './BiroExplorerProvider'
import ExercisePanel from './ExercisePanel'
import { getQuery, handleError } from './utils'
import Sentry from '@sentry/node'
import FeedbackView from './FeedbackView'
import fs from 'fs'

export let log: vscode.LogOutputChannel
export let sentry: Sentry.NodeClient

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Bíró 3 Debug", { log: true })

    const integrations = Sentry.getDefaultIntegrations({}).filter(
        (defaultIntegration) => {
            return !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(
                defaultIntegration.name,
            )
        },
    )

    sentry = new Sentry.NodeClient({
        dsn: "https://2af4dd5806c09e8d5565c477cb76524c@o4512082909724672.ingest.de.sentry.io/4512082919161936",
        transport: Sentry.makeNodeTransport,
        stackParser: Sentry.defaultStackParser,
        integrations: integrations,
    })
    sentry.on('afterSendEvent', (ev, res) => {
        log.trace(`Sentry:`, ev, res)
    })
    const scope = new Sentry.Scope()
    scope.setClient(sentry)
    sentry.init()

    const client = new Biro3Client()
    let selectedExerciseId: number | null = null
    let exercisePanel: ExercisePanel | null = null
    let feedbackView: FeedbackView | null = null


    const exerciseStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
    exerciseStatusItem.hide()

    const coursesViewProvider = new BiroExplorerProvider(client, context.extensionUri)
    const coursesView = vscode.window.createTreeView('biro-courses', {
        treeDataProvider: coursesViewProvider,
        canSelectMany: false,
        showCollapseAll: true,
    })
    coursesViewProvider.view = coursesView


    const onExerciseViewDispose = () => {
        selectedExerciseId = null
        vscode.commands.executeCommand("setContext", "vscbiro3.allowSubmission", selectedExerciseId !== null)
        exerciseStatusItem.text = ''
        exerciseStatusItem.hide()
    }


    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.selectExercise', async (exerciseId: number) => {
        try {
            if (exercisePanel && !exercisePanel.disposed) {
                exercisePanel.reveal(exerciseId, true)
            } else {
                exercisePanel = ExercisePanel.create(context.extensionUri, client, exerciseId, onExerciseViewDispose)
            }
            selectedExerciseId = exerciseId
            const exercise = await client.withReauth(() => client.getExercise(exerciseId))
            exerciseStatusItem.text = `${exercise.indexInTaskList}. ${exercise.displayName}`
            exerciseStatusItem.show()

            vscode.commands.executeCommand("setContext", "vscbiro3.allowSubmission", selectedExerciseId !== null)
        } catch (error) {
            log.error(String(error))
            handleError(error)
        }
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.submit', async (fileUri?: vscode.Uri) => {
        if (selectedExerciseId === null) {
            vscode.window.showErrorMessage(vscode.l10n.t('No exercise has been selected!'))
            return
        }
        const exercise = await client.getExercise(selectedExerciseId)

        if (!fileUri) {
            const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { uri: vscode.Uri }>()
            qp.placeholder = 'Select a file to upload'
            qp.busy = true
            qp.show()

            qp.onDidHide(() => qp.dispose())

            const uris = await vscode.workspace.findFiles(`**/${exercise.expectedFileNames ? exercise.expectedFileNames : '*'}.${exercise.expectedFileFormat}`, null, 30)

            qp.items = uris.map(uri => ({
                label: path.basename(uri.fsPath),
                iconPath: vscode.ThemeIcon.File,
                resourceUri: uri,
                uri: uri,
            }))
            qp.busy = false

            const picked = await new Promise<vscode.Uri>(v => {
                qp.onDidAccept(() => {
                    const selection = qp.selectedItems[0]
                    if (selection) {
                        v(selection.uri)
                    }
                    qp.hide()
                })
            })

            fileUri = picked
        }

        let documentContent = null
        let documentName = null

        const document = vscode.workspace.textDocuments.find(v => v.uri.path === fileUri.path && v.uri.query === fileUri.query && v.uri.scheme === fileUri.scheme && v.uri.fragment === fileUri.fragment && v.uri.authority === fileUri.authority)
        if (document) {
            documentName = document.fileName

            if (document.isClosed) {
                vscode.window.showErrorMessage(vscode.l10n.t('File {0} is closed', fileUri.toString()))
                return
            }

            if ((await vscode.window.showInformationMessage(vscode.l10n.t('Are you sure to upload the file \"{0}\" to the exercise \"{1}. {2}\"?', path.basename(document.fileName), exercise.indexInTaskList, exercise.displayName), { modal: true }, vscode.l10n.t('Yes'))) !== vscode.l10n.t('Yes')) {
                return
            }

            documentContent = document.getText()
        } else if (fileUri.scheme === 'file') {
            if (fs.existsSync(fileUri.fsPath)) {
                documentName = fileUri.fsPath
                documentContent = fs.readFileSync(fileUri.fsPath, 'utf8')
            } else {
                vscode.window.showErrorMessage(vscode.l10n.t('File {0} not found', fileUri.fsPath))
                return
            }
        } else {
            vscode.window.showErrorMessage(vscode.l10n.t('File {0} not found', fileUri.toString()))
            return
        }

        if (!documentName.endsWith(`.${exercise.expectedFileFormat}`)) {
            vscode.window.showErrorMessage(vscode.l10n.t('The file extension must be .{0}', exercise.expectedFileFormat), { modal: true })
            return
        }

        log.debug(`Uploading file ...`)
        const res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: vscode.l10n.t(`Uploading file`),
        }, () => client.withReauth(() => client.submitFile(exercise.assignedExerciseId, path.basename(documentName), documentContent)))
        log.debug(`File uploaded`, res)

        client.invalidateExercise(exercise.assignedExerciseId)

        client.waitForSubmission(res.id, status => {
            client.invalidateExercise(exercise.assignedExerciseId)
            coursesViewProvider.refresh()

            if (status.finished) {
                if (status.score >= status.maxScore) {
                    vscode.window.showInformationMessage(vscode.l10n.t(`Your submission is correct! ({0}/{1})`, status.score, status.maxScore))
                } else {
                    vscode.window.showInformationMessage(vscode.l10n.t(`Your submission is incorrect! ({0}/{1})`, status.score, status.maxScore))
                }
            }
        })

        exercisePanel?.reveal(exercise.assignedExerciseId, false)
    }))

    vscode.workspace.registerTextDocumentContentProvider('birosubmission', new class implements vscode.TextDocumentContentProvider {
        async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
            const q = getQuery(uri)
            const submissionId = Number.parseInt(q['submissionId'])
            const files = await client.withReauth(() => client.getSubmissionFiles(submissionId))
            for (const file of files) {
                if (file.filename === uri.path) {
                    return file.content
                }
            }
            vscode.window.showErrorMessage(vscode.l10n.t('File {0} not found', uri.path))
            return ""
        }
    })

    vscode.workspace.registerTextDocumentContentProvider('birostarterfile', new class implements vscode.TextDocumentContentProvider {
        async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
            const q = getQuery(uri)
            const exerciseId = Number.parseInt(q['exerciseId'])
            const fileId = Number.parseInt(q['fileId'])
            const starterFile = await client.withReauth(() => client.getStarterFile(exerciseId, fileId))
            return Buffer.from(starterFile.content, 'base64').toString()
        }
    })

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.openSubmittedFile', async (submissionId: number, filename: string) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`birosubmission:${filename}?submissionId=${submissionId}`))
        await vscode.window.showTextDocument(doc, { preview: true })
    }))
    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.openStarterFile', async (exerciseId: number, filename: string, fileId: number) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`birostarterfile:${filename}?exerciseId=${exerciseId}&fileId=${fileId}`))
        await vscode.window.showTextDocument(doc, { preview: true })
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.courses.refresh', async () => {
        client.clear()
        coursesViewProvider.refresh()
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.exercise.refresh', async () => {
        if (!exercisePanel) return
        await exercisePanel.update(true)
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.login', async () => {
        await client.login()
        client.clear()
        coursesViewProvider.refresh()
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.logout', async () => {
        client.logout()
    }))

    context.subscriptions.push(vscode.commands.registerCommand('vscbiro3.feedback', async () => {
        try {
            if (!feedbackView || feedbackView.disposed) {
                feedbackView = FeedbackView.create(context.extensionUri)
            }
            feedbackView.reveal()
        } catch (error) {
            log.error(String(error))
            handleError(error)
        }
    }))
}

export function deactivate() {

}
