# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HDR Split Canvas - A Blazor component library for HDR curve editing, systematically evolved from a standalone JavaScript implementation through a series of careful refactoring steps.

## Essential Commands

```bash
# Build entire solution
cd src
dotnet build

# Run demo application
cd HdrSplitControl.Demo
dotnet run
# Browse to http://localhost:5000

# Run tests
cd ../ModelingEvolution.HdrSplitControl.Tests
dotnet test

# Run specific test
dotnet test --filter "FullyQualifiedName~HdrCurveStateTests.GetValueAtX"
```

## The Actual Implementation Process

### Step 1: Create Basic Blazor Component
**Goal**: Wrap the existing JavaScript + HTML in a Razor component

- Created `HdrSplitCanvas.razor` with the HTML structure (canvases, info box, controls)
- Copied JavaScript as-is into `wwwroot/hdr-split.js`
- Added CSS to `wwwroot/hdr-split.css`
- **Tested**: Component rendered and worked exactly like the standalone version

### Step 2: Refactor JavaScript for Single Initialization
**Goal**: Make JavaScript component-friendly with one initialization point

- Changed from `new HDRSplitCanvas()` constructor pattern to `window.hdrGrayCanvasInit()` function
- Consolidated all initialization logic into single entry point
- Stored instance in global map for multiple component support
- **Tested**: JavaScript still worked identically

### Step 3: Add Instance ID Support
**Goal**: Support multiple component instances on same page

```javascript
// Before: Hard-coded element IDs
this.canvas = document.getElementById('canvas');

// After: Dynamic IDs based on instance
const elementIds = {
    canvas: `canvas-${id}`,
    grayscaleBar: `grayscaleBar-${id}`,
    outputBar: `outputBar-${id}`,
    // ... all IDs in one place
};
```

- Added `instanceId` parameter to initialization
- Created `elementIds` object to centralize all DOM element IDs
- Updated Razor component to use `@instanceId` in all element IDs
- **Tested**: Multiple instances could coexist

### Step 4: Add Minimal Event Streaming (JS → C#)
**Goal**: Stream user actions from JavaScript to C# with optimal performance

```csharp
// C# side - optimized method names for minimal payload
[JSInvokable("a")]  // pointAdded
public async Task OnPointAdded(int pointId, float x, float y)

[JSInvokable("d")]  // pointRemoved
public async Task OnPointRemoved(int pointId)

[JSInvokable("mv")] // pointMovedTo
public async Task OnPointMovedTo(int pointId, float x, float y)

[JSInvokable("c1m")] // controlVector1Moved
public async Task OnControlVector1Moved(int pointId, float dx, float dy)

[JSInvokable("c2m")] // controlVector2Moved
public async Task OnControlVector2Moved(int pointId, float dx, float dy)
```

```javascript
// JS side - minimal callbacks
if (this.dotnetRef) {
    this.dotnetRef.invokeMethodAsync('a', newPoint.id, newPoint.x, newPoint.y);
}
```

- Added `DotNetObjectReference` parameter to JS initialization
- Created JSInvokable methods with short names (performance)
- Added callbacks in JavaScript at key interaction points
- **Tested**: Events flowed from JS to C# correctly

### Step 5: Implement C# State Management
**Goal**: C# calculates weights, JavaScript just visualizes

- Created `HdrCurveState` class to manage points and calculate weights
- Moved from linear interpolation to Bezier curves using `ModelingEvolution.Drawing`
- Implemented efficient data structures:
  - `SortedList<float, CurvePoint>` for O(log n) lookups
  - `Dictionary<(int, int), BezierF>` for curve caching
  - Binary search for segment finding
- Added `@bind-Weights` parameter for two-way binding
- **Tested**: C# correctly calculated 256 weight values

### Step 6: Verify with SVG Visualization
**Goal**: Prove C# calculations match visual representation

```razor
<!-- In Home.razor -->
<svg width="512" height="200">
    <path d="@GetWeightPath()" fill="none" stroke="#00d4ff" stroke-width="2" />
</svg>

@code {
    private string GetWeightPath()
    {
        var path = new StringBuilder();
        path.Append($"M 0 {200 - (int)(weights[0] * 200)}");
        for (int x = 1; x < 256; x++)
        {
            path.Append($" L {x * 2} {200 - (int)(weights[x] * 200)}");
        }
        return path.ToString();
    }
}
```

- Added SVG visualization showing C# calculated weights
- Compared with JavaScript canvas rendering
- **Verified**: Curves matched perfectly

## Key Implementation Principles

### 1. Incremental Transformation
- Each step was small, testable, and reversible
- Never broke working functionality
- Tested after every change

### 2. Separation of Concerns
- **JavaScript**: UI interaction, canvas rendering, event detection
- **C#**: State management, calculations, validation
- **Communication**: Minimal, optimized JSInterop

### 3. Performance Optimization
- Short JSInvokable method names (`"a"`, `"d"`, `"mv"`)
- Lazy weight calculation with dirty flag
- Bezier curve caching
- Binary search for segment finding

### 4. Maintainability
- Centralized element IDs in JavaScript
- Fail-fast validation in C#
- Comprehensive unit tests
- Clear ownership boundaries

## Critical Bug Fixes Along the Way

1. **Bezier Parameter Issue**: Linear interpolation of t was wrong
   - Solution: `FindTForX()` with binary search

2. **Selected Point Bug**: Input field edited wrong point after adding new one
   - Solution: Update `selectedPoint` when adding points

3. **Control Point Propagation**: Control point moves weren't reaching C#
   - Solution: Add callbacks in JS control point handlers

4. **Weight Clamping**: Extreme control vectors could produce invalid weights
   - Solution: `Math.Clamp(result.Y, 0, 1)` with Debug.Assert validation

## Architecture Decisions

### Why Keep JavaScript?
- Canvas manipulation is natural in JavaScript
- Real-time mouse tracking needs immediate feedback
- No lag from JSInterop round-trips for UI updates

### Why Move Calculations to C#?
- Complex Bezier math with existing library support
- Type safety and compile-time checking
- Easy unit testing with xUnit
- Better debugging and validation

### Why This Communication Pattern?
- One-way streaming (JS → C#) minimizes latency
- C# recalculates and updates weights array
- Blazor binding handles C# → UI updates
- No chatty back-and-forth during interactions

## Testing Strategy

1. **Unit Tests**: Test C# calculations in isolation
2. **Visual Verification**: SVG overlay confirms correctness
3. **Interactive Testing**: Manual testing of all interactions
4. **Edge Cases**: Extreme values, rapid interactions, multiple instances