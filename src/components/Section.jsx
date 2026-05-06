export default function Section({ icon: Icon, title, subtitle, actions, children }) {
  return (
    <section className="bg-white rounded-lg shadow-sm mb-4 overflow-hidden">
      <div className="section-banner px-4 py-2.5 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4" />}
          <span>{title}</span>
          {subtitle && (
            <span className="text-slate-400 font-normal normal-case tracking-normal text-xs ml-2 hidden sm:inline">
              — {subtitle}
            </span>
          )}
        </div>
        {actions}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
