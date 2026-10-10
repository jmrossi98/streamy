import { describe, it, expect } from "vitest";
import { ACTED, crewSection, orderSections } from "../personCreditRules";

describe("which section a crew credit goes under", () => {
  it("names the headline roles by job", () => {
    expect(crewSection({ job: "Director", department: "Directing" }).label).toBe("Directed");
    expect(crewSection({ job: "Executive Producer", department: "Production" }).label).toBe("Produced");
    expect(crewSection({ job: "Producer", department: "Production" }).label).toBe("Produced");
    expect(crewSection({ job: "Screenplay", department: "Writing" }).label).toBe("Wrote");
    expect(crewSection({ job: "Creator", department: "Creator" }).label).toBe("Created");
  });

  it("does not credit the rest of a department with the headline role", () => {
    expect(crewSection({ job: "First Assistant Director", department: "Directing" }).label).toBe("Directing team");
    expect(crewSection({ job: "Casting", department: "Production" }).label).toBe("Production team");
  });

  it("gives other departments their own section", () => {
    expect(crewSection({ job: "Director of Photography", department: "Camera" })).toEqual({
      key: "crew:camera",
      label: "Cinematography",
    });
    expect(crewSection({ job: "Editor", department: "Editing" }).label).toBe("Editing");
    expect(crewSection({ job: "Thanks", department: "Crew" }).label).toBe("Other crew");
    expect(crewSection({}).label).toBe("Other crew");
  });
});

describe("the order of the sections", () => {
  const sections = [
    crewSection({ job: "Producer", department: "Production" }),
    crewSection({ job: "Editor", department: "Editing" }),
    ACTED,
    crewSection({ job: "Director", department: "Directing" }),
    crewSection({ job: "Director of Photography", department: "Camera" }),
  ];
  const labels = (knownFor: string | null) => orderSections(sections, knownFor).map((s) => s.label);

  it("leads with what the person is known for", () => {
    expect(labels("Acting")).toEqual(["Acted in", "Directed", "Produced", "Cinematography", "Editing"]);
    expect(labels("Production")[0]).toBe("Produced");
  });

  it("falls back to directing first when that is unknown or has no section", () => {
    expect(labels(null)).toEqual(["Directed", "Acted in", "Produced", "Cinematography", "Editing"]);
    expect(labels("Lighting")[0]).toBe("Directed");
  });
});
