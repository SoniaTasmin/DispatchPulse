import { Link, useParams } from 'react-router';
import {
  useCompleteWorkOrderMutation,
  useGetWorkOrderQuery,
  useStartWorkOrderMutation,
  type WorkOrder,
} from '../api';
import { errorToText, toApiError } from '../api-errors';
import { StatusBadge } from '../components/StatusBadge';
import { TechnicianMatches } from '../components/TechnicianMatches';
import { formatDateTime } from '../format';
import { useAppDispatch } from '../store';
import { toastShown } from '../toasts';

export function WorkOrderDetailsPage() {
  const id = Number(useParams().id);
  const isValidId = Number.isInteger(id) && id > 0;
  // currentData: never show a previously viewed work order while this one loads
  // (the page stays mounted when only :id changes, e.g. browser back/forward).
  const {
    currentData: workOrder,
    isFetching,
    error,
  } = useGetWorkOrderQuery(id, { skip: !isValidId });

  if (!isValidId || (error && toApiError(error).status === 404)) {
    return (
      <>
        <BackLink />
        <h1>Work order not found</h1>
      </>
    );
  }
  if (!workOrder && isFetching) {
    return <p className="muted">Loading work order…</p>;
  }
  if (error || !workOrder) {
    return (
      <p className="form-error" role="alert">
        {toApiError(error).messages.join(' ')}
      </p>
    );
  }

  return (
    <>
      <BackLink />
      <div className="page-title">
        <h1>
          {workOrder.title} <span className="muted id">#{workOrder.id}</span>
        </h1>
        <StatusBadge status={workOrder.status} />
      </div>

      <div className="two-column details">
        <section className="card" aria-labelledby="details-heading">
          <h2 id="details-heading">Details</h2>
          <dl className="details-list">
            <dt>City</dt>
            <dd>{workOrder.city}</dd>
            <dt>Required skill</dt>
            <dd>
              <code>{workOrder.requiredSkillCode}</code>
            </dd>
            <dt>Technician</dt>
            <dd>{workOrder.technician?.name ?? 'Not assigned'}</dd>
            {workOrder.description && (
              <>
                <dt>Description</dt>
                <dd>{workOrder.description}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Progress</h2>
          <Timeline workOrder={workOrder} />
          <NextAction workOrder={workOrder} />
        </section>
      </div>

      {workOrder.status === 'OPEN' && (
        <TechnicianMatches workOrder={workOrder} />
      )}
    </>
  );
}

function BackLink() {
  return (
    <p>
      <Link to="/">← All work orders</Link>
    </p>
  );
}

function Timeline({ workOrder }: { workOrder: WorkOrder }) {
  const steps = [
    { status: 'OPEN', label: 'Created', at: workOrder.createdAt },
    {
      status: 'ASSIGNED',
      label: workOrder.technician
        ? `Assigned to ${workOrder.technician.name}`
        : 'Assigned',
      at: workOrder.assignedAt,
    },
    { status: 'IN_PROGRESS', label: 'Work started', at: workOrder.startedAt },
    { status: 'COMPLETED', label: 'Completed', at: workOrder.completedAt },
  ] as const;

  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li
          key={step.status}
          className={step.at ? 'done' : 'pending'}
          aria-current={step.status === workOrder.status ? 'step' : undefined}
        >
          <span className="timeline-label">{step.label}</span>
          {step.at ? (
            <time dateTime={step.at}>{formatDateTime(step.at)}</time>
          ) : (
            <span className="muted">Not yet</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// Shows only the action the current status allows. This is a convenience: the API rejects
// an out-of-order action with 409 regardless of what the page offers.
function NextAction({ workOrder }: { workOrder: WorkOrder }) {
  const dispatch = useAppDispatch();
  const [start, { isLoading: isStarting }] = useStartWorkOrderMutation();
  const [complete, { isLoading: isCompleting }] =
    useCompleteWorkOrderMutation();

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      dispatch(toastShown('success', success));
    } catch (error) {
      dispatch(
        toastShown('error', errorToText(error, workOrder.requiredSkillCode)),
      );
    }
  }

  switch (workOrder.status) {
    case 'OPEN':
      return (
        <p className="next-action">
          Next: assign an eligible technician from the matches below.
        </p>
      );
    case 'ASSIGNED':
      return (
        <button
          type="button"
          className="button-primary"
          disabled={isStarting}
          onClick={() =>
            void run(() => start(workOrder.id).unwrap(), 'Work started.')
          }
        >
          {isStarting ? 'Starting…' : 'Start work'}
        </button>
      );
    case 'IN_PROGRESS':
      return (
        <button
          type="button"
          className="button-primary"
          disabled={isCompleting}
          onClick={() =>
            void run(
              () => complete(workOrder.id).unwrap(),
              'Work order completed.',
            )
          }
        >
          {isCompleting ? 'Completing…' : 'Complete work'}
        </button>
      );
    case 'COMPLETED':
      return (
        <p className="next-action">
          This work order is complete. No further actions.
        </p>
      );
  }
}
