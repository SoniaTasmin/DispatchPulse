import { useState, type FormEvent } from 'react';
import { useCreateWorkOrderMutation, useListSkillsQuery } from '../api';
import { toApiError } from '../api-errors';
import { useAppDispatch } from '../store';
import { toastShown } from '../toasts';

const FIELDS = ['title', 'description', 'city', 'requiredSkill'] as const;
type Field = (typeof FIELDS)[number];

// Form state is local: nothing outside this form needs it, so Redux would add only indirection.
// The browser's required/maxLength checks are a convenience; the API is the authority.
export function CreateWorkOrderForm() {
  const dispatch = useAppDispatch();
  const skills = useListSkillsQuery();
  const [createWorkOrder, { isLoading: isSaving }] =
    useCreateWorkOrderMutation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [requiredSkill, setRequiredSkill] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    try {
      const created = await createWorkOrder({
        title,
        description: description.trim() || undefined,
        city,
        requiredSkill,
      }).unwrap();
      setTitle('');
      setDescription('');
      setCity('');
      setRequiredSkill('');
      dispatch(
        toastShown(
          'success',
          `Work order #${created.id} "${created.title}" created.`,
        ),
      );
    } catch (error) {
      setErrors(toApiError(error).messages);
    }
  }

  // The API's validation messages start with the property name, e.g. "title should not be empty".
  const errorsFor = (field: Field) =>
    errors.filter((message) => message.startsWith(`${field} `));
  const generalErrors = errors.filter(
    (message) => !FIELDS.some((field) => message.startsWith(`${field} `)),
  );
  const fieldProps = (field: Field) => {
    const invalid = errorsFor(field).length > 0;
    return {
      id: `create-${field}`,
      'aria-invalid': invalid,
      'aria-describedby': invalid ? `create-${field}-error` : undefined,
    };
  };
  const fieldError = (field: Field) =>
    errorsFor(field).length > 0 && (
      <p className="field-error" id={`create-${field}-error`}>
        {errorsFor(field).map(capitalize).join('. ')}
      </p>
    );

  return (
    <form className="form" onSubmit={handleSubmit}>
      {generalErrors.length > 0 && (
        <div className="form-error" role="alert">
          {generalErrors.map((message) => (
            <p key={message}>{capitalize(message)}</p>
          ))}
        </div>
      )}

      <div className="field">
        <label htmlFor="create-title">Title</label>
        <input
          {...fieldProps('title')}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="e.g. Repair POS terminal"
        />
        {fieldError('title')}
      </div>

      <div className="field">
        <label htmlFor="create-description">
          Description <span className="optional">(optional)</span>
        </label>
        <textarea
          {...fieldProps('description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
        />
        {fieldError('description')}
      </div>

      <div className="field">
        <label htmlFor="create-city">City</label>
        <input
          {...fieldProps('city')}
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          required
          maxLength={64}
          autoComplete="address-level2"
          placeholder="e.g. Dhaka"
        />
        {fieldError('city')}
      </div>

      <div className="field">
        <label htmlFor="create-requiredSkill">Required skill</label>
        <select
          {...fieldProps('requiredSkill')}
          value={requiredSkill}
          onChange={(e) => setRequiredSkill(e.target.value)}
          required
          disabled={!skills.data}
        >
          <option value="">
            {skills.isLoading ? 'Loading skills…' : 'Choose a skill'}
          </option>
          {skills.data?.map((skill) => (
            <option key={skill.code} value={skill.code}>
              {skill.name} ({skill.code})
            </option>
          ))}
        </select>
        {skills.isError && (
          <p className="field-error">Skills could not be loaded.</p>
        )}
        {fieldError('requiredSkill')}
      </div>

      <button type="submit" className="button-primary" disabled={isSaving}>
        {isSaving ? 'Creating…' : 'Create work order'}
      </button>
    </form>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
