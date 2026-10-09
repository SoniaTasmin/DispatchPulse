import { Fragment } from 'react';
import {
  useAssignWorkOrderMutation,
  useGetTechnicianMatchesQuery,
  useSkillName,
  type IneligibilityReason,
  type TechnicianMatch,
  type WorkOrder,
} from '../api';
import { errorToText, toApiError } from '../api-errors';
import { TECHNICIAN_STATUS_LABELS } from '../format';
import { useAppDispatch } from '../store';
import { toastShown } from '../toasts';

// Every technician is listed: ineligible ones stay visible with the reasons, so a
// dispatcher can see why someone cannot take the job instead of wondering where they went.
export function TechnicianMatches({ workOrder }: { workOrder: WorkOrder }) {
  const dispatch = useAppDispatch();
  const {
    currentData: matches,
    isFetching,
    error,
  } = useGetTechnicianMatchesQuery(workOrder.id);
  const [assign, { isLoading: isAssigning, originalArgs }] =
    useAssignWorkOrderMutation();
  const skillName = useSkillName();
  const requiredSkill = skillName(workOrder.requiredSkillCode);

  // Short labels for the reason chips; the toast keeps the longer wording.
  const reasonLabel = (reason: IneligibilityReason) =>
    reason === 'MISSING_SKILL'
      ? `Missing ${requiredSkill}`
      : reason === 'NOT_AVAILABLE'
        ? 'Not available'
        : 'Different city';

  async function handleAssign({ technician }: TechnicianMatch) {
    try {
      await assign({ id: workOrder.id, technicianId: technician.id }).unwrap();
      dispatch(toastShown('success', `${technician.name} assigned.`));
    } catch (assignError) {
      dispatch(
        toastShown(
          'error',
          errorToText(assignError, workOrder.requiredSkillCode),
        ),
      );
    }
  }

  const eligibleCount = matches?.filter((m) => m.eligible).length ?? 0;

  return (
    <section className="card" aria-labelledby="matches-heading">
      <div className="matches-header">
        <h2 id="matches-heading">Technician matches</h2>
        <p className="matches-summary">
          {matches && (
            <>
              <strong>
                {eligibleCount} of {matches.length}
              </strong>{' '}
              eligible ·{' '}
            </>
          )}
          needs {requiredSkill} in {workOrder.city}
        </p>
      </div>

      {!matches && isFetching ? (
        <p className="muted">Loading technicians…</p>
      ) : error ? (
        <p className="form-error" role="alert">
          {toApiError(error).messages.join(' ')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="matches">
            <thead>
              <tr>
                <th scope="col">Technician</th>
                <th scope="col">City</th>
                <th scope="col">Skills</th>
                <th scope="col">Eligibility</th>
                <th scope="col" className="action-col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {matches?.map((match) => {
                const { technician, eligible, reasons } = match;
                const assigningThis =
                  isAssigning && originalArgs?.technicianId === technician.id;
                return (
                  <tr
                    key={technician.id}
                    className={eligible ? 'eligible' : 'ineligible'}
                  >
                    <th scope="row">
                      <span className="tech-name">{technician.name}</span>
                      <span
                        className={`availability ${technician.status.toLowerCase()}`}
                      >
                        {TECHNICIAN_STATUS_LABELS[technician.status]}
                      </span>
                    </th>
                    <td>{technician.city}</td>
                    <td className="skills">
                      {technician.skills.map((code, index) => (
                        <Fragment key={code}>
                          {index > 0 && ', '}
                          <span
                            className={
                              code === workOrder.requiredSkillCode
                                ? 'required'
                                : undefined
                            }
                          >
                            {skillName(code)}
                          </span>
                        </Fragment>
                      ))}
                    </td>
                    <td>
                      {eligible ? (
                        <span className="chip chip-eligible">Eligible</span>
                      ) : (
                        <>
                          <span className="visually-hidden">Not eligible:</span>
                          <ul className="chips">
                            {reasons.map((reason) => (
                              <li key={reason} className="chip">
                                {reasonLabel(reason)}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </td>
                    <td className="action-col">
                      {eligible && (
                        <button
                          type="button"
                          className="button-primary button-sm"
                          aria-label={`Assign ${technician.name}`}
                          disabled={isAssigning}
                          onClick={() => void handleAssign(match)}
                        >
                          {assigningThis ? 'Assigning…' : 'Assign'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
