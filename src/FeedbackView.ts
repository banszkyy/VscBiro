import * as vscode from 'vscode'
import { log, sentry } from './extension'
import { getNonce, handleError } from './utils'

export default class FeedbackView {
    public static readonly viewType = 'feedback'

    public disposed: boolean
    private readonly panel: vscode.WebviewPanel
    private readonly extensionUri: vscode.Uri

    private disposables: Array<vscode.Disposable> = []

    public static create(extensionUri: vscode.Uri) {
        const panel = vscode.window.createWebviewPanel(
            FeedbackView.viewType,
            vscode.l10n.t('Feedback'),
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
            },
            getWebviewOptions(extensionUri)
        )

        return new FeedbackView(panel, extensionUri)
    }

    constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.disposed = false
        this.panel = panel
        this.extensionUri = extensionUri

        this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon-small.svg')

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'submit':
                        if (!message.message) {
                            vscode.window.showErrorMessage(vscode.l10n.t('Message is required!'))
                            break
                        }

                        const res = sentry.captureEvent({
                            type: 'feedback',
                            level: 'info',
                            contexts: {
                                feedback: {
                                    message: message.message,
                                    email: message.email ? message.email : undefined,
                                    name: message.name ? message.name : undefined,
                                },
                            },
                        })
                        log.debug(`Feedback res:`, res)
                        vscode.window.showInformationMessage(vscode.l10n.t('Thanks 😽'))
                        this.dispose()
                        return
                }
            },
            null,
            this.disposables
        )
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
    }

    public reveal() {
        log.debug(`Revealing feedback webview`)
        this.panel.reveal(undefined, true)
        this.update()
    }

    public update() {
        log.debug(`Updating feedback webview`)

        try {
            this.refreshHtml()
        } catch (error) {
            log.error(String(error))
            handleError(error)
        }
    }

    private refreshHtml() {
        log.debug(`Refreshing feedback webview HTML`)

        const nonce = getNonce()

        this.panel.webview.html =
            `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; img-src data:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'reset.css'))}" rel="stylesheet">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'vscode.css'))}" rel="stylesheet">
				<link href="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'main.css'))}" rel="stylesheet">
				<title>Meow</title>
			</head>
			<body>
				<h1>Feedback</h1>

                <div class="feedback-form">
                    <div class="form-element">
                        <label for="feedback-name">${vscode.l10n.t('Your Name:')}</label>
                        <input type="text" id="feedback-name" placeholder="${vscode.l10n.t('Name')}"/>
                    </div>

                    <div class="form-element">
                        <label for="feedback-email">${vscode.l10n.t('Your Email:')}</label>
                        <input type="email" id="feedback-email" placeholder="${vscode.l10n.t('E-mail')}"/>
                    </div>

                    <div class="form-element">
                        <label for="feedback-message">${vscode.l10n.t('What happened?')} <span class="required-indicator">*</span></label>
                        <textarea id="feedback-message" placeholder="${vscode.l10n.t('Message')}"></textarea>
                    </div>

                    <div class="form-element">
                        <button class="button" id="feedback-submit-button">${vscode.l10n.t('Submit')}</button>
                    </div>
                </div>

				<script nonce="${nonce}" src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'feedback.js'))}"></script>
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
