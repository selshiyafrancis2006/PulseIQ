export default function AlertFilters({ filter, setFilter }) {


  const filters = [
    "all",
    "critical",
    "warning",
    "info"
  ];


  return (

    <div className="flex gap-3 mb-6">

      {
        filters.map(type => (

          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`
              px-4 py-2
              rounded-lg
              text-sm
              ${
                filter === type
                  ? "bg-emerald-500 text-black"
                  : "bg-[#151515] text-gray-400"
              }
            `}
          >
            {type}
          </button>

        ))
      }

    </div>

  );

}