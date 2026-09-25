/** Shared Review/staff presentation; labels and text are never interpreted as markup. */
export default function AnswerValue({ value }) {
  return Array.isArray(value) ? (
    <ul className="mb-0">
      {value.map((label, index) => (
        <li key={index}>{label}</li>
      ))}
    </ul>
  ) : (
    value
  );
}
