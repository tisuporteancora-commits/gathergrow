type Props = {
  title: string;
  onCancel: () => void;
  onConfirm: (username: string, password: string) => void;
  loading?: boolean;
};

export function AuthPrompt({ title, onCancel, onConfirm, loading }: Props) {
  return (
    <div className="fixed inset-0 z-[60] bg-inverse-surface/50 flex items-center justify-center p-space-md">
      <form
        className="bg-surface-container-lowest w-full max-w-sm rounded-xl shadow-xl overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onConfirm(String(fd.get("username") ?? ""), String(fd.get("password") ?? ""));
        }}
      >
        <div className="px-space-lg py-space-md bg-surface-container-low">
          <h3 className="text-headline-md">{title}</h3>
          <p className="text-body-sm text-on-surface-variant mt-space-xs">
            Informe usuário e senha de supervisor/admin.
          </p>
        </div>
        <div className="p-space-lg flex flex-col gap-space-md">
          <label className="flex flex-col gap-space-xs">
            <span className="text-label-sm uppercase text-on-surface-variant">Usuário</span>
            <input
              name="username"
              required
              className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
            />
          </label>
          <label className="flex flex-col gap-space-xs">
            <span className="text-label-sm uppercase text-on-surface-variant">Senha</span>
            <input
              name="password"
              type="password"
              required
              className="bg-surface-container-low px-space-md py-space-sm rounded-xl"
            />
          </label>
        </div>
        <div className="px-space-lg py-space-md bg-surface-container-low flex justify-end gap-space-sm">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-space-lg py-space-sm bg-primary text-on-primary rounded-xl font-semibold disabled:opacity-60"
          >
            {loading ? "Validando..." : "Autorizar"}
          </button>
        </div>
      </form>
    </div>
  );
}
