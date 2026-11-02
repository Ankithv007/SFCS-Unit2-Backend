export interface ValidationErrorPayload {
    errorCode: string;
    message: string;
    currentStage?: string;
    requiredStage?: string;
    workOrder?: string;
    batch?: string;
    actualBatch?: string;
    actualStage?: string;
    suggestedAction?: string;
    severity?: 'error' | 'warning' | 'info';
}

export class ValidationError extends Error {
    public errorCode: string;
    public currentStage?: string;
    public requiredStage?: string;
    public workOrder?: string;
    public batch?: string;
    public actualBatch?: string;
    public actualStage?: string;
    public suggestedAction?: string;
    public severity?: 'error' | 'warning' | 'info';

    constructor(payload: ValidationErrorPayload) {
        super(payload.message);
        this.name = 'ValidationError';
        this.errorCode = payload.errorCode;
        this.currentStage = payload.currentStage;
        this.requiredStage = payload.requiredStage;
        this.workOrder = payload.workOrder;
        this.batch = payload.batch;
        this.actualBatch = payload.actualBatch;
        this.actualStage = payload.actualStage;
        this.suggestedAction = payload.suggestedAction;
        this.severity = payload.severity || 'error';
    }
}
