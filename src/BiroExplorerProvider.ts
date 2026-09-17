import * as vscode from 'vscode'
import { Biro3Client } from './api/Biro3Client'
import { handleError, isAssignmentLocked } from './utils'
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
                
                let suffix = ''
                if (assignment.score === null) {
                    suffix = ''
                } else if (assignment.score >= assignment.maxScore) {
                    suffix = '-pass'
                } else if (assignment.score > assignment.minScore) {
                    suffix = '-progress'
                } else {
                    suffix = '-error'
                }

                if (isAssignmentLocked(assignment) && assignment.postDeadlineHandling === "LOCKED") {
                    item.collapsibleState = vscode.TreeItemCollapsibleState.None
                    item.tooltip = vscode.l10n.t('This assignment is locked')
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'lock.svg')
                } else {
                    item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'assignment-icons', `${({
                        "PRACTICE_ASSIGNMENT": 'exercise',
                        "IN_CLASS_ASSIGNMENT": 'inclass',
                        "OTHER": 'unknown',
                        "REMEDIAL_ASSIGNMENT": 'retake',
                        "EXAM": 'assignment',
                        "MOCK_EXAM": 'mockexam',
                        "HOMEWORK": 'homework',
                        "OPTIONAL_ASSIGNMENT": 'optional',
                        "SANDBOX_TRIAL_ASSIGNMENT": 'sandbox-test',
                    })[assignment.assignmentType]}${suffix}.svg`)
                }

                return item
            }
        }

        if (parts.length === 3) {
            const assignmentAssignedStudentId = Number.parseInt(parts[1])
            const exerciseId = Number.parseInt(parts[2])

            const exercise = this.client.assignmentDetails[assignmentAssignedStudentId]?.exerciseStatuses.find(v => v.assignedExerciseId === exerciseId)
            if (exercise) {
                const item = new vscode.TreeItem(vscode.l10n.t('Task {0}', exercise.exerciseIndex), (this.client.exercises[exerciseId]?.starterFiles ?? [null]).length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
                item.id = element
                item.tooltip = vscode.l10n.t('Select Exercise')
                switch (exercise.exerciseState) {
                    case "COMPLETED": item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'exercise-icons', 'in-progress.svg'); break
                    case "MAX": item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'exercise-icons', 'pass.svg'); break
                    case "COMPLETED_ZERO": item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'exercise-icons', 'error.svg'); break
                    case "NO_SUBMISSION": item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'exercise-icons', 'no-submission.svg'); break
                    case "UNDER_EVALUATION": item.iconPath = vscode.Uri.joinPath(this.extensionRoot, 'assets', 'exercise-icons', 'in-progress.svg'); break
                    default: {
                        const e = `Exercise status "${exercise.exerciseState}" not implemented`
                        log.error(e)
                        handleError(e)
                        break
                    }
                }
                item.command = {
                    command: "vscbiro3.selectExercise",
                    arguments: [exerciseId],
                    title: "Select Exercise",
                }
                return item
            }
        }

        if (parts.length === 4) {
            const exerciseId = Number.parseInt(parts[2])
            const starterFilename = parts[3].split('#')[0]
            const starterFileId = Number.parseInt(parts[3].split('#')[1])

            const item = new vscode.TreeItem(starterFilename, vscode.TreeItemCollapsibleState.None)
            item.id = element
            item.tooltip = vscode.l10n.t('Open File')
            item.resourceUri = vscode.Uri.parse(`birostarterfile:${starterFilename}?exerciseId=${exerciseId}&fileId=${starterFileId}`)
            item.command = {
                command: "vscbiro3.openStarterFile",
                arguments: [exerciseId, starterFilename, starterFileId],
                title: "Open File",
            }
            return item
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

        if (parts.length === 3) {
            const subjectInstanceId = Number.parseInt(parts[0])
            const assignmentAssignedStudentId = Number.parseInt(parts[1])
            const assignedExerciseId = Number.parseInt(parts[2])

            const exercise = await this.client.withReauth(() => this.client.getExercise(assignedExerciseId))
            return exercise.starterFiles.map(v => `${subjectInstanceId}-${assignmentAssignedStudentId}-${assignedExerciseId}-${v.filename}#${v.starterFileId}`)
        }

        return []
    }
}
