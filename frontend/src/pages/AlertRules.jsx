import { useEffect, useState } from 'react'

import AlertRuleCard from '../components/alertRules/AlertRuleCard'
import AlertRulesStats from '../components/alertRules/AlertRulesStats'
import AlertFilters from "../components/alertRules/AlertFilters";
import AlertSummary from "../components/alertRules/AlertSummary";
import { sortAlertRules } from "../utils/alertSort";

import {
  getAlertRules
} from '../services/alert.service'

export default function AlertRules() {

  const [alertRules, setAlertRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [sortBy, setSortBy] = useState("metric")
  const [severity, setSeverity] = useState("all");

  useEffect(() => {
    fetchRules()
  }, [])

  const fetchRules = async () => {

    try {

      const data = await getAlertRules()

      setAlertRules(data)

    } catch (err) {

      console.error(
        'Failed to fetch alert rules:',
        err
      )

    } finally {

      setLoading(false)

    }

  }

const filteredRules = sortAlertRules(

  alertRules.filter(rule => {

    const matchesSearch =
      rule.metric_name
        .toLowerCase()
        .includes(search.toLowerCase());

    const matchesFilter =
      filter === "all"
        ? true
        : filter === "enabled"
        ? rule.is_active
        : !rule.is_active;

    const matchesSeverity =
      severity === "all"
        ? true
        : rule.severity === severity;

    return (
      matchesSearch &&
      matchesFilter &&
      matchesSeverity
    );

  }),

  sortBy

);

  const summary = {
  total: filteredRules.length,
  enabled: filteredRules.filter(rule => rule.is_active).length,
  disabled: filteredRules.filter(rule => !rule.is_active).length,
  critical: filteredRules.filter(rule => rule.severity === "critical").length,
  warning: filteredRules.filter(rule => rule.severity === "warning").length,
  info: filteredRules.filter(rule => rule.severity === "info").length
};

  return (

    <div className="min-h-screen text-white">

      {/* Header */}

      <div className="mb-8">

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

      {/* Stats */}

      <AlertRulesStats
        rules={alertRules}
      />

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

      {/* Rules */}

      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">

        {loading ? (

          <p className="text-gray-400">
            Loading...
          </p>

        ) : filteredRules.length === 0 ? (

          <p className="text-gray-400">
            No matching alert rules found.
          </p>

        ) : (

          filteredRules.map(rule => (

            <AlertRuleCard
              key={rule.id}
              rule={rule}
              setAlertRules={setAlertRules}
            />

          ))

        )}

      </div>

    </div>

  )

}