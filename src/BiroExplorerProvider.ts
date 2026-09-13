import * as vscode from 'vscode'
import { Biro3Client } from './api/Biro3Client'
import { isAssignmentLocked } from './utils'
import { log } from './extension'
import { Assignment } from './api/models'

export class BiroExplorerProvider implements vscode.TreeDataProvider<string> {
    readonly client: Biro3Client
    readonly extensionRoot: vscode.Uri
    view: vscode.TreeView<string>

    constructor(client: Biro3Client, extensionRoot: vscode.Uri) {
        this.client = client
        this.extensionRoot = extensionRoot
        this.view = <vscode.TreeView<string>><any>null
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    refresh(): void { this._onDidChangeTreeData.fire(undefined) }

    getTreeItem(element: string): vscode.TreeItem {
        const parts = element.split('-')
        if (parts.length === 1) {
            const subjectInstanceId = Number.parseInt(parts[0])

            const subject = this.client.subjectInstances?.[subjectInstanceId]
            if (subject) {
                const item = new vscode.TreeItem(subject.subjectName, vscode.TreeItemCollapsibleState.Collapsed)
                let d = ''
                if (subject.roomName) d += subject.roomName
                d += ' '
                if (subject.startTime && subject.endTime) d += `${subject.startTime} - ${subject.endTime}`
                d = d.trim()
                item.description = d ? d : undefined
                item.id = element
                item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'class.svg')
                return item
            }
        }

        if (parts.length === 2) {
            const subjectInstanceId = Number.parseInt(parts[0])
            const assignmentAssignedStudentId = Number.parseInt(parts[1])

            const assignment = this.client.assignments[subjectInstanceId]?.find(v => v.assignmentAssignedStudentId === assignmentAssignedStudentId)
            if (assignment) {
                const item = new vscode.TreeItem(assignment.assignmentName, vscode.TreeItemCollapsibleState.Collapsed)
                item.description = assignment.assignmentDescription
                item.id = element
                if (isAssignmentLocked(assignment) && assignment.postDeadlineHandling === "LOCKED") {
                    item.collapsibleState = vscode.TreeItemCollapsibleState.None
                    item.tooltip = vscode.l10n.t('This assignment is locked')
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'lock.svg')
                } else if (assignment.score === null) {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'no-submission.svg')
                } else if (assignment.score >= assignment.maxScore) {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'pass.svg')
                } else if (assignment.score > assignment.minScore) {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'in-progress.svg')
                } else {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'error.svg')
                }
                return item
            }
        }

        if (parts.length === 3) {
            const assignmentAssignedStudentId = Number.parseInt(parts[1])
            const exerciseId = Number.parseInt(parts[2])

            const exercise = this.client.assignmentDetails[assignmentAssignedStudentId]?.exerciseStatuses.find(v => v.assignedExerciseId === exerciseId)
            if (exercise) {
                const item = new vscode.TreeItem(`${exercise.exerciseIndex}. feladat`, vscode.TreeItemCollapsibleState.None)
                item.id = element
                if (exercise.exerciseState === "COMPLETED") {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'in-progress.svg')
                } else if (exercise.exerciseState === "MAX") {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'pass.svg')
                } else if (exercise.exerciseState === "COMPLETED_ZERO") {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'error.svg')
                } else if (exercise.exerciseState === "NO_SUBMISSION") {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'no-submission.svg')
                } else {
                    log.error(`Exercise status "${exercise.exerciseState}" not implemented`)
                }
                item.command = {
                    command: "vscbiro3.selectExercise",
                    arguments: [exerciseId],
                    title: "Show info",
                }
                return item
            }
        }

        return new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.Collapsed)
    }

    async getChildren(element?: string): Promise<string[]> {
        this.view.description = undefined

        if (!this.client.wasAuthenticated()) {
            return []
        }

        if (!element) {
            const subjectInstances = await this.client.withReauth(() => this.client.getSubjectInstances())

            if (subjectInstances.length === 0) {
                this.view.description = vscode.l10n.t(`You have no courses`)
                return []
            }

            const k = (v: string) => Number.parseInt(v.split('/')[1]) + (Number.parseInt(v.split('/')[2]) - 1) / 2
            return [...subjectInstances]
                .sort((a, b) => k(b.semesterName) - k(a.semesterName))
                .map(v => `${v.subjectInstanceId}`)
        }

        const parts = element.split('-')

        if (parts.length === 1) {
            const subjectInstanceId = Number.parseInt(parts[0])

            const assignments = await this.client.withReauth(() => this.client.getAssignments(subjectInstanceId))
            const typeOrder = Object.freeze([
                "EXAM",
                "MOCK_EXAM",
                "REMEDIAL_ASSIGNMENT",
                "IN_CLASS_ASSIGNMENT",
                "PRACTICE_ASSIGNMENT",
                "HOMEWORK",
                "OPTIONAL_ASSIGNMENT",
                "OTHER",
            ])
            const grouped = assignments
                .reduce((a, v) => {
                    (a[v.assignmentType] ??= []).push(v)
                    return a
                }, <{ [key: string]: Array<Assignment> }>{})
            return Object.keys(grouped)
                .sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b))
                .map(v => grouped[v].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)))
                .flat()
                .map(v => `${subjectInstanceId}-${v.assignmentAssignedStudentId}`)
        }

        if (parts.length === 2) {
            const subjectInstanceId = Number.parseInt(parts[0])
            const assignmentAssignedStudentId = Number.parseInt(parts[1])
            const assignments = await this.client.withReauth(() => this.client.getAssignments(subjectInstanceId))

            const assignment = assignments.find(v => v.assignmentAssignedStudentId == assignmentAssignedStudentId)
            if (!assignment) return []

            if (isAssignmentLocked(assignment) && assignment.postDeadlineHandling === "LOCKED") {
                return Promise.resolve([])
            }

            const { exerciseStatuses } = await this.client.withReauth(() => this.client.getAssignment(assignmentAssignedStudentId))
            return exerciseStatuses
                .map(v => `${subjectInstanceId}-${assignmentAssignedStudentId}-${v.assignedExerciseId}`)
        }

        return []
    }
}
