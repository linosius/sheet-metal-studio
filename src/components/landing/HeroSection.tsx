import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, Box, Ruler, FileOutput } from 'lucide-react';

export function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
      {/* Background grid pattern */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `
          linear-gradient(hsl(var(--cad-grid-major)) 1px, transparent 1px),
          linear-gradient(90deg, hsl(var(--cad-grid-major)) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: `
          linear-gradient(hsl(var(--cad-grid)) 1px, transparent 1px),
          linear-gradient(90deg, hsl(var(--cad-grid)) 1px, transparent 1px)
        `,
        backgroundSize: '12px 12px',
      }} />

      <div className="relative z-10 text-center max-w-4xl mx-auto px-6">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
          <Box className="h-3.5 w-3.5" />
          Browser-Based Sheet Metal Design
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Sketch. Bend.
          <br />
          <span className="text-primary">Unfold.</span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Design sheet metal parts directly in your browser. Create accurate flat patterns
          ready for laser cutting and generate bend data for press brakes — no installs required.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Button
            size="lg"
            className="h-12 px-8 text-base font-semibold gap-2"
            onClick={() => navigate('/workspace')}
          >
            Start Designing
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 px-8 text-base"
          >
            Watch Tutorial
          </Button>
        </div>

        {/* Workflow preview */}
        <div className="flex items-center justify-center gap-3 md:gap-6 flex-wrap">
          {[
            { icon: '✏️', label: '2D Sketch', desc: 'Draw your profile' },
            { icon: '📐', label: 'Base Face', desc: 'Set thickness' },
            { icon: '🔧', label: 'Add Flanges', desc: 'Bend edges' },
            { icon: '📄', label: 'Unfold', desc: 'Flat pattern' },
          ].map((step, i) => (
            <div key={step.label} className="flex items-center gap-3 md:gap-6">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-12 h-12 rounded-lg bg-card border flex items-center justify-center text-xl">
                  {step.icon}
                </div>
                <span className="text-xs font-medium">{step.label}</span>
                <span className="text-[10px] text-muted-foreground">{step.desc}</span>
              </div>
              {i < 3 && (
                <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
