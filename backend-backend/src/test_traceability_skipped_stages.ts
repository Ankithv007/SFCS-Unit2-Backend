import pool from './config/db';
import { WorkflowEngineService } from './services/workflow/WorkflowEngineService';

// Standard pipeline definitions exactly matching TrackItems.tsx
const PRODUCTION_PIPELINE = [
    { code: 'PTH', name: 'Pre-Soldering', label: 'PTH' },
    { code: 'VI', name: 'Visual Inspection', label: 'VI' },
    { code: 'QA', name: 'Quality Assurance', label: 'QA' },
    { code: 'FLASHING', name: 'Flashing', label: 'Flashing' },
    { code: 'PCBA_FCT', name: 'PCBA FCT', label: 'PCBA-FCT' },
    { code: 'ASSEMBLY', name: 'Assembly', label: 'Assembly' },
    { code: 'UNIT_TESTING', name: 'Unit Testing', label: 'Unit Testing' },
    { code: 'QI', name: 'Quality Inspection', label: 'QI' },
    { code: 'PACKING', name: 'Packing', label: 'Packing' }
];

const normalizeStageId = (s: string) => (s || '').toUpperCase().replace(/[\s\-_]/g, '');

function isStageInRoute(stage: { code: string; name: string; label: string }, activeRoute: any[], selectedStages: any): boolean {
    if (Array.isArray(activeRoute)) {
        const stageCodeNorm = normalizeStageId(stage.code);
        const stageNameNorm = normalizeStageId(stage.name);
        const stageLabelNorm = normalizeStageId(stage.label);

        return activeRoute.some(r => {
            const rCodeNorm = normalizeStageId(r.stage_code);
            const rNameNorm = normalizeStageId(r.stage_name);
            return (
                rCodeNorm === stageCodeNorm ||
                rNameNorm === stageNameNorm ||
                rCodeNorm === stageLabelNorm ||
                rNameNorm === stageLabelNorm ||
                rCodeNorm === stageNameNorm ||
                rNameNorm === stageCodeNorm
            );
        });
    }

    if (selectedStages !== undefined) {
        if (selectedStages === null) return true;
        let list: any[] = [];
        if (Array.isArray(selectedStages)) list = selectedStages;
        else if (typeof selectedStages === 'string') {
            try { list = JSON.parse(selectedStages); } catch { list = []; }
        }
        if (list.length === 0) return false;
        const stageCodeNorm = normalizeStageId(stage.code);
        const stageNameNorm = normalizeStageId(stage.name);
        const stageLabelNorm = normalizeStageId(stage.label);
        return list.some(item => {
            const itemStr = typeof item === 'string' ? item : (item?.stage_code || item?.stage_name || '');
            const itemNorm = normalizeStageId(itemStr);
            return (
                itemNorm === stageCodeNorm ||
                itemNorm === stageNameNorm ||
                itemNorm === stageLabelNorm ||
                (stageCodeNorm === 'PTH' && itemNorm === 'PRESOLDERING') ||
                (stageCodeNorm === 'QA' && itemNorm === 'QUALITYASSURANCE') ||
                (stageCodeNorm === 'VI' && itemNorm === 'VISUALINSPECTION') ||
                (stageCodeNorm === 'QI' && itemNorm === 'QUALITYINSPECTION')
            );
        });
    }

    return true;
}

function computePipelineStatuses(activeRoute: any[], selectedStages: any, scanHistory: any[], currentStage: string, currentStatus: string) {
    return PRODUCTION_PIPELINE.map(stage => {
        if (!isStageInRoute(stage, activeRoute, selectedStages)) {
            return { stage: stage.label, status: 'SKIPPED' };
        }
        const entries = scanHistory.filter(h => h.station === stage.name || h.station === stage.code || h.station === stage.label);
        const hasPassed = entries.some(e => e.status === 'ACCEPTED' || e.status === 'PASS');
        const isCurrent = currentStage === stage.name || currentStage === stage.code || currentStage === stage.label;
        if (hasPassed) {
            return { stage: stage.label, status: 'ACCEPTED' };
        }
        if (isCurrent) {
            return { stage: stage.label, status: currentStatus === 'ACCEPTED' || currentStatus === 'COMPLETED' ? 'ACCEPTED' : 'IN_PROGRESS' };
        }
        return { stage: stage.label, status: 'pending' };
    });
}

async function runTests() {
    console.log('🚀 Starting Verification of Traceability Pipeline Skipped Stages...\n');
    let passCount = 0;
    let failCount = 0;

    function assert(condition: boolean, message: string) {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passCount++;
        } else {
            console.error(`  ❌ FAIL: ${message}`);
            failCount++;
        }
    }

    try {
        // -------------------------------------------------------------
        // Test 1: PTH -> QA
        // -------------------------------------------------------------
        console.log('--- Test 1: Route [PTH, QA] ---');
        const route1 = await WorkflowEngineService.resolveActiveRoute({ stagesList: ['PTH', 'QA'] });
        const pipeline1 = computePipelineStatuses(route1, ['PTH', 'QA'], [{ station: 'Pre-Soldering', status: 'ACCEPTED' }], 'Quality Assurance', 'PENDING');
        const map1 = Object.fromEntries(pipeline1.map(p => [p.stage, p.status]));

        assert(map1['PTH'] === 'ACCEPTED', 'PTH shows ACCEPTED (actual status)');
        assert(map1['VI'] === 'SKIPPED', 'VI shows SKIPPED');
        assert(map1['QA'] === 'IN_PROGRESS', 'QA shows IN_PROGRESS/pending (actual status)');
        assert(map1['Flashing'] === 'SKIPPED', 'Flashing shows SKIPPED');
        assert(map1['PCBA-FCT'] === 'SKIPPED', 'PCBA-FCT shows SKIPPED');
        assert(map1['Assembly'] === 'SKIPPED', 'Assembly shows SKIPPED');
        assert(map1['Unit Testing'] === 'SKIPPED', 'Unit Testing shows SKIPPED');
        assert(map1['QI'] === 'SKIPPED', 'QI shows SKIPPED');
        assert(map1['Packing'] === 'SKIPPED', 'Packing shows SKIPPED');

        // -------------------------------------------------------------
        // Test 2: PTH -> VI -> QA -> Packing
        // -------------------------------------------------------------
        console.log('\n--- Test 2: Route [PTH, VI, QA, Packing] ---');
        const route2 = await WorkflowEngineService.resolveActiveRoute({ stagesList: ['PTH', 'VI', 'QA', 'Packing'] });
        const pipeline2 = computePipelineStatuses(route2, ['PTH', 'VI', 'QA', 'Packing'], [
            { station: 'Pre-Soldering', status: 'ACCEPTED' },
            { station: 'Visual Inspection', status: 'ACCEPTED' }
        ], 'Quality Assurance', 'IN_PROGRESS');
        const map2 = Object.fromEntries(pipeline2.map(p => [p.stage, p.status]));

        assert(map2['PTH'] === 'ACCEPTED', 'PTH shows ACCEPTED');
        assert(map2['VI'] === 'ACCEPTED', 'VI shows ACCEPTED');
        assert(map2['QA'] === 'IN_PROGRESS', 'QA shows IN_PROGRESS');
        assert(map2['Packing'] === 'pending', 'Packing shows pending (in active route)');
        assert(map2['Flashing'] === 'SKIPPED', 'Flashing shows SKIPPED');
        assert(map2['PCBA-FCT'] === 'SKIPPED', 'PCBA-FCT shows SKIPPED');
        assert(map2['Assembly'] === 'SKIPPED', 'Assembly shows SKIPPED');
        assert(map2['Unit Testing'] === 'SKIPPED', 'Unit Testing shows SKIPPED');
        assert(map2['QI'] === 'SKIPPED', 'QI shows SKIPPED');

        // -------------------------------------------------------------
        // Test 3: QA Only
        // -------------------------------------------------------------
        console.log('\n--- Test 3: Route [QA] Only ---');
        const route3 = await WorkflowEngineService.resolveActiveRoute({ stagesList: ['QA'] });
        const pipeline3 = computePipelineStatuses(route3, ['QA'], [], 'Quality Assurance', 'PENDING');
        const map3 = Object.fromEntries(pipeline3.map(p => [p.stage, p.status]));

        assert(map3['QA'] === 'IN_PROGRESS', 'QA shows actual status (IN_PROGRESS)');
        assert(map3['PTH'] === 'SKIPPED', 'PTH shows SKIPPED');
        assert(map3['VI'] === 'SKIPPED', 'VI shows SKIPPED');
        assert(map3['Flashing'] === 'SKIPPED', 'Flashing shows SKIPPED');
        assert(map3['PCBA-FCT'] === 'SKIPPED', 'PCBA-FCT shows SKIPPED');
        assert(map3['Assembly'] === 'SKIPPED', 'Assembly shows SKIPPED');
        assert(map3['Unit Testing'] === 'SKIPPED', 'Unit Testing shows SKIPPED');
        assert(map3['QI'] === 'SKIPPED', 'QI shows SKIPPED');
        assert(map3['Packing'] === 'SKIPPED', 'Packing shows SKIPPED');

        // -------------------------------------------------------------
        // Test 4: All Stages Selected
        // -------------------------------------------------------------
        console.log('\n--- Test 4: All Stages Selected ---');
        const allStagesList = ['PTH', 'VI', 'QA', 'FLASHING', 'PCBA-FCT', 'ASSEMBLY', 'UNIT_TESTING', 'QI', 'PACKING'];
        const route4 = await WorkflowEngineService.resolveActiveRoute({ stagesList: allStagesList });
        const pipeline4 = computePipelineStatuses(route4, allStagesList, [], 'Pre-Soldering', 'PENDING');
        const map4 = Object.fromEntries(pipeline4.map(p => [p.stage, p.status]));

        assert(!Object.values(map4).includes('SKIPPED'), 'No stage shows SKIPPED when all stages are selected');
        assert(map4['PTH'] === 'IN_PROGRESS', 'PTH shows actual status');
        assert(map4['Packing'] === 'pending', 'Packing shows pending');

        // -------------------------------------------------------------
        // Test 5: Legacy Work Order (selected_stages = NULL)
        // -------------------------------------------------------------
        console.log('\n--- Test 5: Legacy Work Order (selected_stages = NULL) ---');
        const route5 = await WorkflowEngineService.resolveActiveRoute({ selectedStages: null });
        const pipeline5 = computePipelineStatuses(route5, null, [{ station: 'Pre-Soldering', status: 'ACCEPTED' }], 'Pre-Soldering', 'ACCEPTED');
        const map5 = Object.fromEntries(pipeline5.map(p => [p.stage, p.status]));

        assert(!Object.values(map5).includes('SKIPPED'), 'Legacy Work Order does NOT mark all stages skipped');
        assert(map5['PTH'] === 'ACCEPTED', 'PTH shows ACCEPTED');
        assert(map5['VI'] === 'pending', 'VI shows pending (in default route)');

        // -------------------------------------------------------------
        // Test 6: Empty selected_stages = []
        // -------------------------------------------------------------
        console.log('\n--- Test 6: Empty Routing Configuration [] ---');
        let caughtError = false;
        try {
            await WorkflowEngineService.resolveActiveRoute({ selectedStages: [] });
        } catch (err: any) {
            caughtError = true;
            assert(err.errorCode === 'INVALID_STAGE_SELECTION', 'Empty route throws ValidationError INVALID_STAGE_SELECTION');
        }
        assert(caughtError, 'Empty routing configuration [] rejected as invalid');

        console.log(`\n========================================`);
        console.log(`Total Tests Passed: ${passCount}`);
        console.log(`Total Tests Failed: ${failCount}`);
        console.log(`========================================\n`);

        process.exit(failCount > 0 ? 1 : 0);
    } catch (e: any) {
        console.error('Fatal error during test run:', e);
        process.exit(1);
    }
}

runTests();
