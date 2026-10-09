import { Link, useParams } from 'react-router';
import {
  useCompleteWorkOrderMutation,
  useGetWorkOrderQuery,
  useSkillName,
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
  const skillName = useSkillName();

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

  const requiredSkill = skillName(workOrder.requiredSkillCode);

  return (
    <>
      <header className="page-header">
        <BackLink />
        <div className="page-title">
          <h1>{workOrder.title}</h1>
          <StatusBadge status={workOrder.status} />
        </div>
        <p className="page-meta">
          <span className="id">#{workOrder.id}</span>
          <span>{workOrder.city}</span>
          <span>{requiredSkill}</span>
        </p>
      </header>

      <div className="two-column details">
        <section className="card" aria-labelledby="details-heading">
          <h2 id="details-heading">Details</h2>
          <dl className="details-list">
            <dt>Technician</dt>
            <dd className={workOrder.technician ? undefined : 'unset'}>
              {workOrder.technician?.name ?? 'Not assigned'}
            </dd>
            <dt>City</dt>
            <dd>{workOrder.city}</dd>
            <dt>Required skill</dt>
            <dd>{requiredSkill}</dd>
            {workOrder.description && (
              <>
                <dt>Description</dt>
                <dd className="prose">{workOrder.description}</dd>
              </>
            )}
          </dl>
        </section>

        <section
          className="card progress-card"
          aria-labelledby="progress-heading"
        >
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
    <Link className="back-link" to="/">
      Back to work orders
    </Link>
  );
}

function Timeline({ workOrder }: { workOrder: WorkOrder }) {
  const steps = [
    { status: 'OPEN', label: 'Created', at: workOrder.createdAt },
    { status: 'ASSIGNED', label: 'Assigned', at: workOrder.assignedAt },
    { status: 'IN_PROGRESS', label: 'In progress', at: workOrder.startedAt },
    { status: 'COMPLETED', label: 'Completed', at: workOrder.completedAt },
  ] as const;

  return (
    <ol className="stepper">
      {steps.map((step) => (
        <li
          key={step.status}
          className={step.at ? 'done' : 'pending'}
          aria-current={step.status === workOrder.status ? 'step' : undefined}
        >
          <span className="step-label">{step.label}</span>
          {step.at ? (
            <time className="step-time" dateTime={step.at}>
              {formatDateTime(step.at)}
            </time>
          ) : (
            <span className="step-time">Not yet</span>
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
        <div className="next-action">
          <p>Next: assign an eligible technician from the matches below.</p>
        </div>
      );
    case 'ASSIGNED':
      return (
        <div className="next-action">
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
        </div>
      );
    case 'IN_PROGRESS':
      return (
        <div className="next-action">
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
        </div>
      );
    case 'COMPLETED':
      return (
        <div className="next-action">
          <p>This work order is complete. No further actions.</p>
        </div>
      );
  }
}
