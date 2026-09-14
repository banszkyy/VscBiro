(function () {
    const vscode = acquireVsCodeApi()

    document.getElementById('feedback-submit-button').addEventListener('click', () => {
        const feedbackName = document.getElementById('feedback-name').value.trim()
        const feedbackEmail = document.getElementById('feedback-email').value.trim()
        const feedbackMessage = document.getElementById('feedback-message').value.trim()

        vscode.postMessage({
            command: 'submit',
            name: feedbackName,
            email: feedbackEmail,
            message: feedbackMessage,
        })
    })
})()