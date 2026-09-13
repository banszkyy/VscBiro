import { Assignment } from './api/models'
import * as vscode from 'vscode'

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

function sleep(delay: number): Promise<void> {
    return new Promise(v => setTimeout(v, delay))
}

export function rateLimiter<TArgs extends any[], TReturn>(f: (...args: TArgs) => TReturn, cooldown: number): (...args: TArgs) => Promise<TReturn> {
    let lastTime = Date.now()
    return (async (...args) => {
        const now = Date.now()
        const d = now - lastTime
        if (d < cooldown) await sleep(d)
        return f(...args)
    })
}
