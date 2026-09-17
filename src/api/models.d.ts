export interface Assignment {
    readonly assignmentAssignedStudentId: number
    readonly startTime: string
    readonly endTime: string
    readonly assignmentName: string
    readonly assignmentDescription: string
    readonly assignmentType: "PRACTICE_ASSIGNMENT" | "IN_CLASS_ASSIGNMENT" | "OTHER" | "REMEDIAL_ASSIGNMENT" | "EXAM" | "MOCK_EXAM" | "HOMEWORK" | "OPTIONAL_ASSIGNMENT" | "SANDBOX_TRIAL_ASSIGNMENT"
    readonly maxScore: number
    readonly minScore: number
    readonly score: number | null
    readonly subjectName: string
    readonly semesterName: string
    readonly studentGroupName: unknown
    readonly studentGroupMembers: unknown
    readonly subjectInstanceId: number
    readonly postDeadlineHandling: "VIEW_ONLY" | "LOCKED" | "SUBMIT_WITH_NO_POINTS"
    readonly starterFiles: ReadonlyArray<AssignmentStarterFile>
}

export interface AssignmentStarterFile {
    readonly assignmentStarterFileId: number
    readonly filename: string
    readonly displayDirectory: string
}

export interface StarterFile {
    readonly starterFileId: number
    readonly filename: string
    readonly viewable: boolean
    readonly copyable: boolean
    readonly downloadable: boolean
}

export interface Exercise {
    readonly assignedExerciseId: number
    readonly indexInTaskList: number
    readonly type: string | "AUTO_EVALUATION"
    readonly name: string
    readonly displayName: string
    readonly description: string
    readonly difficultyLevel: number
    readonly maxScore: number
    readonly minScore: number
    readonly uploadLimit: number
    readonly expectedFileFormat: string
    readonly expectedFileNames: string
    readonly onlyAllowExpectedFilenames: boolean
    readonly timeLimit: unknown | null
    readonly starterFiles: ReadonlyArray<StarterFile>
    readonly taskImages: ReadonlyArray<TaskImage>
    readonly tags: ReadonlyArray<unknown>
    readonly score: number
    readonly submissions: ReadonlyArray<Submission>
}

export interface TaskImage {
    readonly taskimageId: number
    readonly filename: string
}

export interface ExerciseStatus {
    readonly assignedExerciseId: number
    readonly exerciseIndex: number
    readonly exerciseState: "NO_SUBMISSION" | "COMPLETED" | "MAX" | "COMPLETED_ZERO" | "UNDER_EVALUATION"
}

export interface ReportContent {
    readonly report_type: "BIRO3_SIMPLE" | string
    readonly tests: ReadonlyArray<ReportTestGroup>
    readonly version: "1" | string
}

export interface ReportTestGroup {
    readonly name: string
    readonly tests: ReadonlyArray<ReportTest>
    readonly score?: number
    readonly max?: number
}

export interface ReportTest {
    readonly name: string
    readonly score: number
    readonly max: number
    readonly message: string
}

export interface SubjectInstance {
    readonly subjectInstanceId: number
    readonly courseId: number
    readonly subjectCode: string
    readonly subjectName: string
    readonly semesterName: string
    readonly courseCode: string
    readonly courseDay: string
    readonly startTime: string | null
    readonly endTime: string | null
    readonly roomName: string | null
}

export interface Evaluation {
    readonly evaluationId: number
    readonly score: number
    readonly message: string
    readonly evaluationTime: string
}

export interface Submission {
    readonly submissionId: number
    readonly name: string
    readonly score: number
    readonly status: "EVALUATED" | "UNDER_EVALUATION" | "ERROR"
    readonly submissionTime: string
    readonly ipAddress: string
    readonly evaluations: ReadonlyArray<Evaluation>
}

export interface SubmissionStatus {
    state: "EVALUATED" | "UNDER_EVALUATION" | "ERROR"
    finished: boolean
    score: number
    maxScore: number
    evaluationId: number
}

export interface StarterFile {
    readonly filename: string
    readonly content: string
}
