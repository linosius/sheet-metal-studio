import { Ruler, Box, FileOutput, Settings2 } from 'lucide-react';

const features = [
  {
    icon: Ruler,
    title: '2D Precision Sketcher',
    description: 'Draw profiles with snap-to-grid, exact dimension input, and intuitive line and rectangle tools. Every measurement is accurate to 0.01mm.',
  },
  {
    icon: Box,
    title: '3D Visualization',
    description: 'See your sheet metal part in full 3D with orbit controls. Click edges to add flanges with configurable bend angles and directions.',
  },
  {
    icon: Settings2,
    title: 'Engineering Accuracy',
    description: 'K-Factor bend calculations using industry-standard formulas. Set material type, thickness, and bend radius for production-ready results.',
  },
  {
    icon: FileOutput,
    title: 'Multi-Format Export',
    description: 'Export flat patterns as DXF for laser cutters, SVG for versatility, PDF with dimensions, and bend tables for press brakes.',
  },
];

export function FeaturesSection() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Everything You Need to Design Sheet Metal
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            From initial sketch to machine-ready output — all in one tool.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group p-8 rounded-xl border bg-card hover:border-primary/30 transition-all duration-300"
            >
              <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center mb-5">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
