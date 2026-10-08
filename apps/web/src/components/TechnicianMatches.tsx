import {
  useAssignWorkOrderMutation,
  useGetTechnicianMatchesQuery,
  type TechnicianMatch,
  type WorkOrder,
} from '../api';
import { describeReason, errorToText, toApiError } from '../api-errors';
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
      <h2 id="matches-heading">Technician matches</h2>
      <p className="muted">
        Needs <code>{workOrder.requiredSkillCode}</code> in {workOrder.city}.
        {matches &&
          ` ${eligibleCount} of ${matches.length} technicians are eligible.`}
      </p>

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
                <th scope="col">Availability</th>
                <th scope="col">Skills</th>
                <th scope="col">Eligibility</th>
                <th scope="col">
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
                    className={eligible ? undefined : 'ineligible'}
                  >
                    <th scope="row">{technician.name}</th>
                    <td>{technician.city}</td>
                    <td>{TECHNICIAN_STATUS_LABELS[technician.status]}</td>
                    <td>{technician.skills.join(', ')}</td>
                    <td>
                      {eligible ? (
                        <span className="eligibility eligible">Eligible</span>
                      ) : (
                        <>
                          <span className="eligibility">Not eligible</span>
                          <ul className="reasons">
                            {reasons.map((reason) => (
                              <li key={reason}>
                                {describeReason(
                                  reason,
                                  workOrder.requiredSkillCode,
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </td>
                    <td>
                      {eligible && (
                        <button
                          type="button"
                          className="button-primary"
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
