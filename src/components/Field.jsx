export default function Field({ label, hint, children }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <label className="ros-label">{label}</label>
        {hint && (
          <span className="text-[10px] text-slate-400 italic truncate">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
