import { StationId } from '../common/stationRegistry';
import { TransitionRule } from '../ecn/ecnTransitions';

export const NON_ECN_TRANSITION_RULES: TransitionRule[] = [
    { from: 'INWARD', to: 'IVI', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'IVI', to: 'NON_ECN_POST_BURN_IN_INITIAL', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'NON_ECN_POST_BURN_IN_INITIAL', to: 'NON_ECN_PROGRAMMING', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'NON_ECN_PROGRAMMING', to: 'NON_ECN_PRE_BURN_IN', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'NON_ECN_PRE_BURN_IN', to: 'NON_ECN_HIPOT', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'NON_ECN_HIPOT', to: 'NON_ECN_POST_BURN_IN_FINAL', acceptedStatuses: ['PASS', 'COMPLETED'] }
];
