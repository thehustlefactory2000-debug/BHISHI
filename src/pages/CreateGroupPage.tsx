import { FormEvent, useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { useAppStore } from "../store/useAppStore";
import { GroupDraft, MemberContributor, MemberDraft } from "../types";
import { calculatePayment } from "../utils/calculatePayment";
import { formatCurrency, todayIso } from "../utils/format";
import { uid } from "../utils/helpers";

const emptyContributor = (): MemberContributor => ({ id: uid(), name: "", phone: "" });
const emptyMember = (): MemberDraft => ({ id: uid(), name: "", phone: "", contributors: [] });

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());

export function CreateGroupPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createGroup = useAppStore((state) => state.createGroup);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedContributors, setExpandedContributors] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<GroupDraft>({
    name: "",
    monthlyAmount: 500,
    totalMembers: 3,
    interestRatePercent: 1,
    startDate: todayIso(),
    payoutDate: 10,
    members: [emptyMember(), emptyMember(), emptyMember()]
  });

  useEffect(() => {
    setDraft((current) => {
      if (current.members.length === current.totalMembers) return current;
      const members = Array.from({ length: current.totalMembers }, (_, index) => current.members[index] ?? emptyMember());
      return { ...current, members };
    });
  }, [draft.totalMembers]);

  useEffect(() => {
    setExpandedContributors((current) =>
      draft.members.reduce<Record<string, boolean>>((next, member) => {
        next[member.id] = current[member.id] ?? member.contributors.length > 0;
        return next;
      }, {})
    );
  }, [draft.members]);

  const preview = Array.from({ length: draft.totalMembers }, (_, index) => {
    const monthNumber = index + 1;
    return {
      monthNumber,
      expectedAmount: calculatePayment(draft.monthlyAmount, draft.interestRatePercent / 100, draft.totalMembers, monthNumber)
    };
  });

  const setMember = (index: number, patch: Partial<MemberDraft>) => {
    const members = [...draft.members];
    members[index] = { ...members[index], ...patch };
    setDraft({ ...draft, members });
  };

  const setContributor = (memberIndex: number, contributorIndex: number, patch: Partial<MemberContributor>) => {
    const members = [...draft.members];
    const contributors = [...members[memberIndex].contributors];
    contributors[contributorIndex] = { ...contributors[contributorIndex], ...patch };
    members[memberIndex] = { ...members[memberIndex], contributors };
    setDraft({ ...draft, members });
  };

  const addMember = () => {
    if (draft.members.length >= draft.totalMembers) return;
    setDraft({ ...draft, totalMembers: draft.totalMembers + 1, members: [...draft.members, emptyMember()] });
  };

  const removeMember = (index: number) => {
    if (draft.members.length <= 2) return;
    const members = draft.members.filter((_, memberIndex) => memberIndex !== index);
    setDraft({ ...draft, totalMembers: draft.totalMembers - 1, members });
  };

  const addContributor = (memberIndex: number) => {
    const members = [...draft.members];
    members[memberIndex] = {
      ...members[memberIndex],
      contributors: [...members[memberIndex].contributors, emptyContributor()]
    };
    setDraft({ ...draft, members });
  };

  const removeContributor = (memberIndex: number, contributorIndex: number) => {
    const members = [...draft.members];
    members[memberIndex] = {
      ...members[memberIndex],
      contributors: members[memberIndex].contributors.filter((_, index) => index !== contributorIndex)
    };
    setDraft({ ...draft, members });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const normalizedMembers = draft.members.map((member) => ({
      ...member,
      name: member.name.trim(),
      phone: member.phone.trim(),
      contributors: member.contributors
        .map((contributor) => ({
          ...contributor,
          name: contributor.name.trim(),
          phone: contributor.phone.trim()
        }))
        .filter((contributor) => contributor.name || contributor.phone)
    }));
    const memberNames = normalizedMembers.map((member) => member.name.toLowerCase());

    if (!draft.name.trim()) return setError(t("errorGroupNameRequired"));
    if (draft.name.trim().length > 50) return setError(t("errorGroupNameLength"));
    if (!Number.isFinite(draft.monthlyAmount) || draft.monthlyAmount < 1) return setError(t("errorMonthlyAmount"));
    if (!Number.isInteger(draft.totalMembers) || draft.totalMembers < 2 || draft.totalMembers > 50) return setError(t("errorMembersRange"));
    if (draft.interestRatePercent < 0 || draft.interestRatePercent > 10) return setError(t("errorInterestRange"));
    if (!isIsoDate(draft.startDate) || draft.startDate < todayIso()) return setError(t("errorStartDate"));
    if (draft.payoutDate < 1 || draft.payoutDate > 28) return setError(t("errorPayoutDate"));
    if (draft.members.length !== draft.totalMembers) return setError(t("errorMemberCountMismatch"));
    if (normalizedMembers.some((member) => !member.name)) return setError(t("errorMemberNameRequired"));
    if (normalizedMembers.some((member) => member.name.length > 100)) return setError(t("errorMemberNameLength"));
    if (normalizedMembers.some((member) => !/^\d{10}$/.test(member.phone))) return setError("Every member needs a 10-digit phone number.");
    if (new Set(memberNames).size !== memberNames.length) return setError("Member names must be unique within the group.");
    if (normalizedMembers.some((member) => member.contributors.some((contributor) => !contributor.name || !contributor.phone))) {
      return setError("If you add a contributor, both contributor name and phone are required.");
    }
    if (normalizedMembers.some((member) => member.contributors.some((contributor) => contributor.name.length > 100))) {
      return setError("Contributor names must be under 100 characters.");
    }
    if (normalizedMembers.some((member) => member.contributors.some((contributor) => !/^\d{10}$/.test(contributor.phone)))) {
      return setError(t("errorPhoneDigits"));
    }

    const payload = {
      ...draft,
      name: draft.name.trim(),
      members: normalizedMembers
    };

    setSaving(true);
    try {
      const groupId = await createGroup(payload);
      navigate(`/groups/${groupId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("failedToCreateGroup"));
    } finally {
      setSaving(false);
    }
  };

  const membersAtMax = draft.members.length >= draft.totalMembers;

  return (
    <AppShell title={t("createGroupTitle")} subtitle={t("createGroupSubtitle")} backTo="/dashboard" stickyHeader={false}>
      <form className="grid gap-4 sm:gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6" onSubmit={submit}>
        <div className="space-y-4 sm:space-y-6">
          <section className="card p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold sm:text-xl">{t("groupDetails")}</h2>
                <p className="mt-1 text-sm leading-6 text-subtle">{t("groupDetailsSubtitle")}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4">
              <div className="sm:col-span-2">
                <label className="label">{t("groupName")}</label>
                <input className="input" maxLength={50} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("enterGroupName")} />
              </div>
              <div>
                <label className="label">{t("monthlyAmountInr")}</label>
                <input className="input" type="text" inputMode="numeric" min="1" value={draft.monthlyAmount} onChange={(e) => setDraft({ ...draft, monthlyAmount: Number(e.target.value) })} placeholder="500" />
              </div>
              <div>
                <label className="label">{t("totalMembersLabel")}</label>
                <input className="input" type="text" inputMode="numeric" min="2" max="50" value={draft.totalMembers} onChange={(e) => setDraft({ ...draft, totalMembers: Number(e.target.value) })} placeholder="3" />
              </div>
              <div>
                <label className="label">{t("interestRatePercent")}</label>
                <input className="input" type="text" inputMode="numeric" min="0" max="10" step="any" value={draft.interestRatePercent} onChange={(e) => setDraft({ ...draft, interestRatePercent: Number(e.target.value) })} placeholder="1.0" />
              </div>
              <div>
                <label className="label">{t("payoutDay")}</label>
                <input className="input" type="text" inputMode="numeric" min="1" max="28" value={draft.payoutDate} onChange={(e) => setDraft({ ...draft, payoutDate: Number(e.target.value) })} placeholder="10" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t("startDate")}</label>
                <input className="input" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="card p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold sm:text-xl">{t("members")}</h2>
                <p className="mt-1 text-sm leading-6 text-subtle">
                  {t("createGroupMembersSubtitle", { current: draft.members.length, total: draft.totalMembers })}
                </p>
                <p className="mt-1 text-xs leading-5 text-subtle">
                  Each member needs a name and phone number. Contributors are optional; if none are added, the member is treated as the contributor automatically.
                </p>
              </div>
              <button
                className="btn-secondary w-full sm:w-auto"
                type="button"
                onClick={addMember}
                disabled={membersAtMax}
                title={membersAtMax ? t("maxMembersReached", { count: draft.totalMembers }) : t("addMember")}
              >
                <Plus size={16} />
                {t("addMember")}
              </button>
            </div>
            <div className="mt-5 space-y-4">
              {draft.members.map((member, index) => {
                const contributorsVisible = expandedContributors[member.id] || member.contributors.length > 0;

                return (
                  <div key={member.id} className="soft-panel p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-text">{t("memberLabel", { index: index + 1 })}</p>
                        <p className="mt-1 text-xs text-subtle">This member seat pays every month and can win once.</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <button
                          className="icon-btn"
                          type="button"
                          onClick={() => removeMember(index)}
                          aria-label={t("removeMember", { index: index + 1 })}
                          disabled={draft.members.length <= 2}
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          className={`icon-btn ${contributorsVisible ? "bg-muted text-text" : ""}`}
                          type="button"
                          onClick={() =>
                            setExpandedContributors((current) => ({
                              ...current,
                              [member.id]: !contributorsVisible
                            }))
                          }
                          aria-label={contributorsVisible ? "Hide contributors section" : "Show contributors section"}
                          aria-expanded={contributorsVisible}
                        >
                          {contributorsVisible ? <Minus size={16} /> : <Plus size={16} />}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label">{t("memberName")}</label>
                        <input className="input" maxLength={100} value={member.name} onChange={(e) => setMember(index, { name: e.target.value })} placeholder="Member name" />
                      </div>
                      <div>
                        <label className="label">{t("phoneNumber")}</label>
                        <input className="input" inputMode="numeric" value={member.phone} onChange={(e) => setMember(index, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="10 digit member phone" />
                      </div>
                    </div>

                    <div className={`overflow-hidden transition-all duration-300 ease-out ${contributorsVisible ? "mt-4 max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}>
                      <div className="border-t border-border/70 pt-4">
                        <div className="rounded-2xl border border-border bg-surface/70 p-3 sm:p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-text">Contributors</h3>
                                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-subtle">
                                  {member.contributors.length}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-subtle">Optional. Add contributor contacts only when this member seat is shared by multiple people.</p>
                            </div>
                            <button
                              className="btn-secondary w-full sm:w-auto"
                              type="button"
                              onClick={() => addContributor(index)}
                            >
                              <Plus size={16} />
                              Add contributor
                            </button>
                          </div>

                          {member.contributors.length === 0 ? (
                            <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-subtle">
                              No contributors added. The member phone will be used as the payment contact.
                            </div>
                          ) : (
                            <div className="mt-4 space-y-3">
                              {member.contributors.map((contributor, contributorIndex) => (
                                <div key={contributor.id} className="rounded-2xl border border-border bg-muted/70 p-3">
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
                                      Contributor {contributorIndex + 1}
                                    </p>
                                    <button
                                      className="icon-btn h-10 w-10 shrink-0"
                                      type="button"
                                      onClick={() => removeContributor(index, contributorIndex)}
                                      aria-label={`Remove contributor ${contributorIndex + 1}`}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <label className="label">Contributor name</label>
                                      <input className="input" maxLength={100} value={contributor.name} onChange={(e) => setContributor(index, contributorIndex, { name: e.target.value })} />
                                    </div>
                                    <div>
                                      <label className="label">{t("phoneNumber")}</label>
                                      <input className="input" inputMode="numeric" value={contributor.phone} onChange={(e) => setContributor(index, contributorIndex, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="space-y-5 sm:space-y-6  xl:top-28 xl:self-start">
          <section className="card p-4 sm:p-6">
            <h2 className="text-lg font-semibold sm:text-xl">{t("preview")}</h2>
            <p className="mt-2 text-sm leading-6 text-subtle">{t("previewSubtitle")}</p>
            <div className="mt-4 overflow-x-auto rounded-[20px] border border-border mobile-scroll sm:mt-5 sm:rounded-[24px]">
              <table className="min-w-[320px] w-full text-sm sm:min-w-[420px]">
                <thead className="bg-muted text-left text-subtle">
                  <tr>
                    <th className="px-3 py-2 sm:px-4 sm:py-3">{t("month")}</th>
                    <th className="px-3 py-2 sm:px-4 sm:py-3">{t("dueDay")}</th>
                    <th className="px-3 py-2 sm:px-4 sm:py-3">{t("expectedAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.monthNumber} className="border-t border-border">
                      <td className="px-3 py-2 font-medium sm:px-4 sm:py-3">{t("month")} {row.monthNumber}</td>
                      <td className="px-3 py-2 sm:px-4 sm:py-3">{t("dayLabel", { day: draft.payoutDate })}</td>
                      <td className="px-3 py-2 sm:px-4 sm:py-3">{formatCurrency(row.expectedAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4 sm:p-6">
            <button className="btn-primary w-full" disabled={saving} type="submit">
              {saving ? t("creatingGroup") : t("createGroup")}
            </button>
            {error && (
              <p className="mt-3 rounded-xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
          </section>
        </aside>
      </form>
    </AppShell>
  );
}
