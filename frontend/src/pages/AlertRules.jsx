import { useEffect, useState } from 'react';

import AlertRuleCard from '../components/alertRules/AlertRuleCard';
import AlertRuleForm from '../components/alertRules/AlertRuleForm';
import AlertRulesStats from '../components/alertRules/AlertRulesStats';
import AlertFilters from "../components/alertRules/AlertFilters";
import AlertSummary from "../components/alertRules/AlertSummary";
import { sortAlertRules } from "../utils/alertSort";
import useHosts from '../hooks/useHosts';

import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule
} from '../services/alert.service';

export default function AlertRules() {
  const [alertRules, setAlertRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("metric");
  const [severity, setSeverity] = useState("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [pageError, setPageError] = useState("");

  const { hosts, error: hostsError } = useHosts();

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const data = await getAlertRules();
      setAlertRules(data);
      setPageError("");
    } catch (err) {
      console.error('Failed to fetch alert rules:', err);
      setPageError(err.message || 'Failed to load alert rules.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async (payload) => {
    const created = await createAlertRule(payload);
    setAlertRules((prev) => [...prev, created]);
    setShowCreateForm(false);
    setPageError("");
  };

  const handleUpdateRule = async (payload) => {
    const updated = await updateAlertRule(editingRuleId, payload);

    setAlertRules((prev) =>
      prev.map((rule) =>
        Number(rule.id) === Number(updated.id) ? updated : rule
      )
    );

    setEditingRuleId(null);
    setPageError("");
  };

  const handleDeleteRule = async (id) => {
    await deleteAlertRule(id);
    setAlertRules((prev) =>
      prev.filter((rule) => Number(rule.id) !== Number(id))
    );
    setPageError("");
  };

  const filteredRules = sortAlertRules(
    alertRules.filter((rule) => {
      const matchesSearch = (rule.metric_name || "")
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "enabled"
            ? rule.is_active
            : !rule.is_active;

      const matchesSeverity =
        severity === "all" ? true : rule.severity === severity;

      return matchesSearch && matchesFilter && matchesSeverity;
    }),
    sortBy
  );

  const summary = {
    total: filteredRules.length,
    enabled: filteredRules.filter((rule) => rule.is_active).length,
    disabled: filteredRules.filter((rule) => !rule.is_active).length,
    critical: filteredRules.filter((rule) => rule.severity === "critical").length,
    warning: filteredRules.filter((rule) => rule.severity === "warning").length,
    info: filteredRules.filter((rule) => rule.severity === "info").length
  };

  return (
    <div className="min-h-screen text-white">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400">
            Configuration
          </p>

          <h1 className="text-4xl font-bold mt-2">
            Alert Rules
          </h1>

          <p className="text-gray-400 mt-2">
            Configure thresholds for monitoring metrics.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingRuleId(null);
            setShowCreateForm((current) => !current);
            setPageError("");
          }}
          className="px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold"
        >
          {showCreateForm ? "Close Form" : "+ Create Rule"}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-6">
          <AlertRuleForm
            hosts={hosts}
            onSave={handleCreateRule}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {editingRuleId !== null && (
        <div className="mb-6">
          <AlertRuleForm
            key={editingRuleId}
            rule={alertRules.find(
              (rule) => Number(rule.id) === Number(editingRuleId)
            )}
            hosts={hosts}
            onSave={handleUpdateRule}
            onCancel={() => setEditingRuleId(null)}
          />
        </div>
      )}

      {pageError && (
        <p role="alert" className="mb-5 text-sm text-red-400">
          {pageError}
        </p>
      )}

      {hostsError && (
        <p role="alert" className="mb-5 text-sm text-amber-400">
          Host list unavailable: {hostsError}
        </p>
      )}

      <AlertRulesStats rules={alertRules} />

      <AlertFilters
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        severity={severity}
        setSeverity={setSeverity}
        sortBy={sortBy}
        setSortBy={setSortBy}
      />

      <AlertSummary summary={summary} />

      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : filteredRules.length === 0 ? (
          <p className="text-gray-400">
            No matching alert rules found.
          </p>
        ) : (
          filteredRules.map((rule) => (
            <AlertRuleCard
              key={rule.id}
              rule={rule}
              setAlertRules={setAlertRules}
              onEdit={() => {
                setShowCreateForm(false);
                setEditingRuleId(rule.id);
              }}
              onDelete={() => handleDeleteRule(rule.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
