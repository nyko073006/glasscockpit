import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { readFrontmatter, splitFrontmatter } from "../src/core/frontmatter";

describe("splitFrontmatter", () => {
  it("LF: trennt Frontmatter und Body", () => {
    expect(splitFrontmatter("---\nname: a\n---\nText\n")).toEqual({ frontmatter: "name: a", body: "Text\n" });
  });
  it("CRLF: Frontmatter mit \\n normalisiert", () => {
    expect(splitFrontmatter("---\r\nname: a\r\nx: 1\r\n---\r\nText")).toEqual({ frontmatter: "name: a\nx: 1", body: "Text" });
  });
  it("BOM wird entfernt", () => {
    expect(splitFrontmatter("﻿---\nname: a\n---\nB").frontmatter).toBe("name: a");
  });
  it("ohne Start: ganzer Text als Body", () => {
    expect(splitFrontmatter("Text\n---\nx\n---\n")).toEqual({ frontmatter: null, body: "Text\n---\nx\n---\n" });
  });
  it("Start mit Leerzeichen zählt nicht", () => {
    expect(splitFrontmatter("--- \nname: a\n---\n").frontmatter).toBeNull();
  });
  it("ohne Abschluss: null, Body ganz", () => {
    expect(splitFrontmatter("---\nname: a\nText")).toEqual({ frontmatter: null, body: "---\nname: a\nText" });
  });
  it("leeres Frontmatter", () => {
    expect(splitFrontmatter("---\n---\nB")).toEqual({ frontmatter: "", body: "B" });
  });
});

describe("readFrontmatter mit echtem yaml", () => {
  it("liest Strings, Zahlen, Booleans; Rest ignoriert", () => {
    const r = readFrontmatter("---\nname:  a  \nn: 3\nflag: false\nlist: [1, 2]\nobj: {a: 1}\nleer:\n---\nB", parse);
    expect(r.fields).toEqual({ name: "a", n: "3", flag: "false" });
    expect(r.body).toBe("B");
  });
  it("Blockskalar >- ist der Text", () => {
    const r = readFrontmatter("---\nname: x\ndescription: >-\n  Erste Zeile\n  zweite Zeile\n---\n", parse);
    expect(r.fields.description).toBe("Erste Zeile zweite Zeile");
  });
  it("Blockskalar | ist der Text", () => {
    const r = readFrontmatter("---\ndescription: |\n  Eins\n  Zwei\n---\n", parse);
    expect(r.fields.description).toBe("Eins\nZwei");
  });
  it("kaputtes YAML: fields leer, kein Throw", () => {
    const r = readFrontmatter("---\nname: [unclosed\n  : : :\n---\nB", parse);
    expect(r.fields).toEqual({});
    expect(r.body).toBe("B");
  });
  it("Parse-Funktion, die wirft: fields leer", () => {
    expect(readFrontmatter("---\na: 1\n---\n", () => { throw new Error("x"); }).fields).toEqual({});
  });
  it("Nicht-Objekt (Liste, Skalar): leer", () => {
    expect(readFrontmatter("---\n- a\n- b\n---\n", parse).fields).toEqual({});
    expect(readFrontmatter("---\njust text\n---\n", parse).fields).toEqual({});
  });
  it("ohne Frontmatter: leer, Body ganz", () => {
    expect(readFrontmatter("Hallo", parse)).toEqual({ fields: {}, body: "Hallo" });
  });
});
