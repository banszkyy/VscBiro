import { ApiError } from './api/ApiError'
import { Assignment } from './api/models'
import * as vscode from 'vscode'
import { sentry } from './extension'
import { OkayError } from './api/OkayError'

export async function fetchUpWithProgress(input: string | URL | Request, init: RequestInit, progress: (current: number, total: number) => void) {
    const encoder = new TextEncoder()
    let blob: Blob
    if (typeof init.body === "string") {
        blob = new Blob([(encoder.encode(init.body))])
    } else if (init.body instanceof Blob) {
        blob = init.body
    } else if (ArrayBuffer.isView(init.body)) {
        blob = new Blob([init.body])
    } else if (init.body instanceof ArrayBuffer) {
        blob = new Blob([init.body])
    } else {
        return await fetch(input, init)
    }

    let bytesUploaded = 0

    return await fetch(input, {
        ...init,
        body: blob.stream().pipeThrough(new TransformStream<Uint8Array<ArrayBufferLike>>({
            transform(chunk, controller) {
                controller.enqueue(chunk)
                bytesUploaded += chunk.byteLength
                progress(bytesUploaded, blob.size)
            },
        })),
        duplex: "half",
    })
}

export function isAssignmentLocked(assignment: Assignment): false | "EARLY" | "LATE" {
    const startTime = Date.parse(assignment.startTime)
    const endTime = Date.parse(assignment.endTime)
    const now = Date.now()
    if (now < startTime) {
        return 'EARLY'
    } else if (now < endTime) {
        return false
    } else {
        return 'LATE'
    }
}

export function getQuery(uri: vscode.Uri) {
    const q = (uri.query ?? '').replace('?', '').split('&')
    const res: { [key: string]: string } = {}
    for (const v of q) {
        res[v.split('=')[0]] = v.split('=')[1]
    }
    return res
}

export function sleep(delay: number): Promise<void> {
    return new Promise(v => setTimeout(v, delay))
}

export function rateLimiter<TArgs extends any[], TReturn>(f: (...args: TArgs) => TReturn, cooldown: number): (...args: TArgs) => Promise<TReturn> {
    let lastTime = Date.now()
    return (async (...args) => {
        const now = Date.now()
        const d = now - lastTime
        if (d < cooldown) await sleep(d)
        lastTime = now
        return f(...args)
    })
}

export function getNonce() {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

export function handleError(error: unknown) {
    if (error instanceof OkayError) return
    if (error instanceof ApiError) return
    if (String(error) === 'TypeError: fetch failed') return

    vscode.window.showErrorMessage(vscode.l10n.t('An error occurred! Please report it so I can fix it.'), vscode.l10n.t('Report'))
        .then(res => {
            if (res === vscode.l10n.t('Report')) {
                sentry.captureException(error)
                vscode.window.showInformationMessage(vscode.l10n.t('Thanks 😽'))
            }
        })
}

declare global {
    interface Promise<T> {
        isFinished(): Promise<boolean>
    }
}

Promise.prototype.isFinished = async function () {
    return (await Promise.race([this, Promise.resolve('pending')])) !== 'pending'
}
