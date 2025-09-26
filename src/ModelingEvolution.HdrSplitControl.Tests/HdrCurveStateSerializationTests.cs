using System.Globalization;
using System.Text.Json;
using ModelingEvolution.Drawing;
using ModelingEvolution.HdrSplitControl;
using Xunit;
using Xunit.Abstractions;

namespace ModelingEvolution.HdrSplitControl.Tests;

public class HdrCurveStateSerializationTests
{
    private readonly ITestOutputHelper _output;

    public HdrCurveStateSerializationTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void RoundTrip_DefaultState_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();

        // Act - Convert to string and parse back
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Compare weights
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
        }
    }

   

    [Fact]
    public void RoundTrip_MultiplePoints_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);
        original.AddPoint(10, 0, 0.2f);
        original.AddPoint(11, 85, 0.8f);
        original.AddPoint(12, 170, 0.4f);
        original.AddPoint(13, 255, 0.6f);

        // Act
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Compare weights
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
        }
    }

    [Fact]
    public void RoundTrip_WithControlVectors_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);
        original.AddPoint(20, 0, 0.5f);
        original.AddPoint(21, 255, 0.5f);

        // Add control vectors to create a curve
        original.MoveControlVector2(20, 50, 0.3f);
        original.MoveControlVector1(21, -50, -0.3f);

        // Act
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Compare weights
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
        }
    }

    [Fact]
    public void RoundTrip_ComplexCurve_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);

        // Create an S-curve
        original.AddPoint(30, 0, 0.1f);
        original.AddPoint(31, 64, 0.2f);
        original.AddPoint(32, 128, 0.5f);
        original.AddPoint(33, 192, 0.8f);
        original.AddPoint(34, 255, 0.9f);

        // Add control vectors for smoothness
        original.MoveControlVector2(30, 20, 0.0f);
        original.MoveControlVector1(31, -20, 0.0f);
        original.MoveControlVector2(31, 20, 0.1f);
        original.MoveControlVector1(32, -20, -0.1f);
        original.MoveControlVector2(32, 20, 0.1f);
        original.MoveControlVector1(33, -20, -0.1f);
        original.MoveControlVector2(33, 20, 0.0f);
        original.MoveControlVector1(34, -20, 0.0f);

        // Act
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Compare weights
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
        }
    }

    [Fact]
    public void TryParse_InvalidString_ReturnsFalse()
    {
        // Arrange
        var invalidStrings = new[]
        {
            "not an svg path",
            "M 0 0 Q 100 100", // Unsupported quadratic Bezier
        };

        // Act & Assert
        foreach (var invalid in invalidStrings)
        {
            var result = HdrCurveState.TryParse(invalid, CultureInfo.InvariantCulture, out var state);
            Assert.False(result, $"Should fail to parse: '{invalid}'");
            Assert.Null(state);
        }
    }

    [Fact]
    public void TryParse_EmptyString_ReturnsEmptyState()
    {
        // Act
        var result = HdrCurveState.TryParse("", CultureInfo.InvariantCulture, out var state);

        // Assert
        Assert.True(result);
        Assert.NotNull(state);
        // Empty state should have default weights (0.5)
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(0.5f, state.Weights[i], 0.001f);
        }
    }

   

    [Fact]
    public void JsonSerialization_RoundTrip_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);
        original.AddPoint(40, 0, 0.3f);
        original.AddPoint(41, 128, 0.7f);
        original.AddPoint(42, 255, 0.4f);

        // Add control vectors
        original.MoveControlVector2(40, 30, 0.1f);
        original.MoveControlVector1(41, -30, -0.1f);
        original.MoveControlVector2(41, 30, 0.1f);
        original.MoveControlVector1(42, -30, -0.1f);

        // Act - Serialize to JSON and back
        var json = JsonSerializer.Serialize(original);
        _output.WriteLine($"JSON: {json}");
        var restored = JsonSerializer.Deserialize<HdrCurveState>(json);

        // Assert
        Assert.NotNull(restored);
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
        }
    }

    [Fact]
    public void JsonSerialization_DefaultState_ProducesCompactJson()
    {
        // Arrange
        var state = new HdrCurveState();

        // Act
        var json = JsonSerializer.Serialize(state);
        _output.WriteLine($"JSON: {json}");

        // Assert
        Assert.NotNull(json);
        Assert.Contains("M", json); // Should contain SVG path commands
        Assert.Contains("C", json); // Should contain cubic Bezier commands

        // Deserialize back
        var restored = JsonSerializer.Deserialize<HdrCurveState>(json);
        Assert.NotNull(restored);
    }

    [Fact]
    public void RoundTrip_ExtremeControlVectors_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);
        original.AddPoint(50, 0, 0.5f);
        original.AddPoint(51, 255, 0.5f);

        // Add extreme control vectors
        original.MoveControlVector2(50, 100, 5.0f);
        original.MoveControlVector1(51, -100, -5.0f);

        // Act
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Weights should be clamped but match
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.001f);
            Assert.True(restored.Weights[i] >= 0.0f && restored.Weights[i] <= 1.0f);
        }
    }

    [Fact]
    public void RoundTrip_ManyPoints_PreservesData()
    {
        // Arrange
        var original = new HdrCurveState();
        original.RemovePoint(1);
        original.RemovePoint(2);

        // Add many points
        for (int i = 0; i <= 10; i++)
        {
            float x = i * 25.5f; // 0 to 255
            float y = (float)Math.Sin(i * Math.PI / 10) * 0.4f + 0.5f; // Sine wave
            original.AddPoint(100 + i, x, y);

            // Add some control vectors
            if (i > 0 && i < 10)
            {
                original.MoveControlVector1(100 + i, -10, 0);
                original.MoveControlVector2(100 + i, 10, 0);
            }
        }

        // Act
        var svgPath = original.ToString();
        _output.WriteLine($"SVG Path (length: {svgPath.Length}): {svgPath}");
        var restored = HdrCurveState.Parse(svgPath, CultureInfo.InvariantCulture);

        // Assert - Compare weights with slightly higher tolerance for complex curves
        for (int i = 0; i < 256; i++)
        {
            Assert.Equal(original.Weights[i], restored.Weights[i], 0.01f);
        }
    }

    [Fact]
    public void ToString_ProducesValidSvgPath()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(60, 0, 0.25f);
        state.AddPoint(61, 127, 0.75f);
        state.AddPoint(62, 255, 0.25f);

        // Act
        var svgPath = state.ToString();
        _output.WriteLine($"SVG Path: {svgPath}");

        // Assert
        Assert.StartsWith("M", svgPath); // Should start with Move command
        Assert.Contains("C", svgPath); // Should contain Cubic Bezier commands

        // Should be parseable as Path<float>
        var path = Path<float>.Parse(svgPath, CultureInfo.InvariantCulture);
        Assert.NotNull(path);
        Assert.True(path.Segments.Count > 0);
    }
}