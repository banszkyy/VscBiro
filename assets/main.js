(function () {
    const l10n = JSON.parse(document.getElementById('l10n')?.innerText ?? "{}")

    function refreshTimeLabels() {
        const now = Math.floor(Date.now() / 1000)
        for (const element of document.getElementsByClassName('time')) {
            let t = 0
            if (element.getAttribute('data-time')) {
                t = Number.parseInt(String(element.getAttribute('data-time')))
            } else {
                t = Math.floor(Date.parse(element.textContent) / 1000)
                element.setAttribute('data-time', t)
            }

            let d = now - t

            if (d < 0) {
                element.textContent = l10n['now']
                continue
            }

            if (d < 60) {
                element.textContent = `${d} ${l10n['sec']}`
                continue
            }

            d = Math.floor(d / 60)
            if (d < 60) {
                element.textContent = `${d} ${l10n['min']}`
                continue
            }

            d = Math.floor(d / 60)
            if (d < 24) {
                element.textContent = `${d} ${l10n['hour']}`
                continue
            }

            d = Math.floor(d / 24)
            element.textContent = `${d} ${l10n['day']}`
        }
    }

    setInterval(refreshTimeLabels, 500)
    refreshTimeLabels()

    const vscode = acquireVsCodeApi()

    for (const element of document.getElementsByClassName('file-link')) {
        element.addEventListener('click', () => {
            vscode.postMessage({
                command: 'open-file',
                filename: element.getAttribute('data-filename'),
                submissionId: Number(element.getAttribute('data-submission')),
            })
        })
    }

    for (const element of document.getElementsByClassName('starter-file-link')) {
        element.addEventListener('click', () => {
            vscode.postMessage({
                command: 'open-starter-file',
                filename: element.getAttribute('data-filename'),
                fileId: element.getAttribute('data-fileid'),
            })
        })
    }

    if (submitFileButton = document.getElementById('submit-file-button')) {
        submitFileButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'upload-submission',
            })
        })
    }

    if (submitFileButton = document.getElementById('next-button')) {
        submitFileButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'next-exercise',
            })
        })
    }

    if (submitFileButton = document.getElementById('previous-button')) {
        submitFileButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'previous-exercise',
            })
        })
    }

    if (confetti = document.getElementById('confetti')) {
        confetti.addEventListener('click', () => {
            vscode.postMessage({
                command: 'stop-confetti'
            })
            document.getElementById('confetti')?.classList.remove('confetti')
        })
    }

    if (confetti = document.getElementById('show-confetti')) {
        confetti.addEventListener('click', (/** @type {MouseEvent} */ e) => {
            vscode.postMessage({
                command: 'show-confetti'
            })
            document.getElementById('confetti')?.classList.add('confetti')
            e.stopPropagation()
        })
    }

    for (const submission of document.getElementsByClassName('submission')) {
        submission.getElementsByClassName('submission-title')[0]?.addEventListener('click', () => {
            const w = submission.classList.toggle('hidden')
            vscode.postMessage({
                command: 'toggle-submission-visibility',
                submissionId: Number.parseInt(submission.id.split('-')[1]),
                visible: !w,
            })
        })
    }
})()
