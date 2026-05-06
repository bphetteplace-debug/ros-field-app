export default function Field({ label, children }) {
  return (
    <div>
      <label className="ros-label">{label}</label>
      {children}
    </div>
  );
}
